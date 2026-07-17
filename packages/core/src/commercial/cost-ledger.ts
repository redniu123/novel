import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { addDecimalStrings } from "./model-price-table.js";
import { z } from "zod";
import { BookWriteLockError, StateManager } from "../state/manager.js";
import { assertSafeBookId } from "../utils/book-id.js";
import { safeChildPath } from "../utils/path-safety.js";
import {
  VolumeChapterProductionStatusSchema,
  VolumePipelineStatusSchema,
  VolumeProductionStopReasonSchema,
} from "./volume-production-state.js";

/**
 * TASK-004A: append-only, per-book commercial cost ledger.
 *
 * One JSONL line per commercial production run. Authoritative order is the
 * file line order backed by the monotonic `seq` field; `recordedAt` is a
 * display-only wall clock stamp (clock rollback must never reorder audits).
 * Ledger data lives under `<book>/commercial/` only and must never flow into
 * story-authoritative state (project principle; red-team finding B1).
 */
export const COST_LEDGER_SCHEMA_VERSION = 1 as const;
export const COST_LEDGER_RELATIVE_PATH = "commercial/cost-ledger.jsonl";
export const COST_LEDGER_FAILURES_RELATIVE_PATH = "commercial/cost-ledger-failures.json";
export const COST_LEDGER_TORN_BACKUP_PREFIX = "commercial/cost-ledger.torn.";

const IsoDateSchema = z.string().datetime();
const NonNegativeIntSchema = z.number().int().nonnegative();
const DecimalStringSchema = z.string().regex(/^\d+(\.\d+)?$/, "expected a non-negative decimal string");

export const CostLedgerTokenUsageSchema = z
  .object({
    promptTokens: NonNegativeIntSchema,
    completionTokens: NonNegativeIntSchema,
    totalTokens: NonNegativeIntSchema,
  })
  .strict();
export type CostLedgerTokenUsageV1 = z.infer<typeof CostLedgerTokenUsageSchema>;

export const CostUnavailableReasonSchema = z.enum([
  "model_not_found",
  "price_table_invalid",
  "price_table_missing",
  "token_usage_missing",
]);
export type CostUnavailableReason = z.infer<typeof CostUnavailableReasonSchema>;

export const CostLedgerCostSchema = z
  .object({
    currency: z.string().min(1),
    promptCost: DecimalStringSchema,
    completionCost: DecimalStringSchema,
    totalCost: DecimalStringSchema,
    priceTableVersion: z.string().min(1),
    unitPriceSnapshot: z
      .object({
        promptPerMTokens: DecimalStringSchema,
        completionPerMTokens: DecimalStringSchema,
      })
      .strict(),
    approximate: z.boolean(),
  })
  .strict();
export type CostLedgerCostV1 = z.infer<typeof CostLedgerCostSchema>;

/**
 * Closed field set. `.strict()` plus the model-identity allowlist (`model`,
 * `overrideModels` as bare model names) is load-bearing: no baseUrl, header,
 * or credential-derived value may ever enter a ledger entry (finding B3).
 */
export const CostLedgerEntrySchema = z
  .object({
    schemaVersion: z.literal(COST_LEDGER_SCHEMA_VERSION),
    seq: z.number().int().positive(),
    entryId: z.string().min(1),
    runId: z.string().min(1),
    bookId: z.string().min(1),
    chapterNumber: z.number().int().positive().optional(),
    recordedAt: IsoDateSchema,
    productionStatus: VolumeChapterProductionStatusSchema,
    pipelineStatus: VolumePipelineStatusSchema.optional(),
    stopReason: VolumeProductionStopReasonSchema.optional(),
    tokenUsage: CostLedgerTokenUsageSchema.optional(),
    /** Unknown upstream usage fields, snapshotted verbatim (finding U4). */
    usageExtra: z.record(z.string(), z.unknown()).optional(),
    inkosVersion: z.string().min(1),
    model: z.string().min(1),
    overrideModels: z.array(z.string().min(1)).optional(),
    cost: CostLedgerCostSchema.optional(),
    costUnavailableReason: CostUnavailableReasonSchema.optional(),
  })
  .strict();
export type CostLedgerEntryV1 = z.infer<typeof CostLedgerEntrySchema>;

export const CostLedgerErrorCodeSchema = z.enum([
  "LEDGER_INVALID_PATH",
  "LEDGER_INVALID_JSON",
  "LEDGER_INVALID_SCHEMA",
  "LEDGER_UNSUPPORTED_VERSION",
  "LEDGER_BOOK_ID_MISMATCH",
  "LEDGER_TORN_TAIL",
  "LEDGER_DUPLICATE_RUN",
  "LEDGER_REPAIR_FAILED",
  "LEDGER_READ_FAILED",
  "LEDGER_WRITE_FAILED",
]);
export type CostLedgerErrorCode = z.infer<typeof CostLedgerErrorCodeSchema>;

export class CostLedgerError extends Error {
  readonly relativePath = COST_LEDGER_RELATIVE_PATH;

  constructor(
    readonly code: CostLedgerErrorCode,
    readonly bookId: string,
    message: string,
    readonly options: {
      readonly runId?: string;
      readonly lineNumber?: number;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "CostLedgerError";
  }
}

export const CostLedgerFailureMarkerSchema = z
  .object({
    schemaVersion: z.literal(COST_LEDGER_SCHEMA_VERSION),
    failureCount: NonNegativeIntSchema,
    lastErrorCode: z.string().min(1),
    lastFailedAt: IsoDateSchema,
    missedRunIds: z.array(z.string().min(1)),
  })
  .strict();
export type CostLedgerFailureMarkerV1 = z.infer<typeof CostLedgerFailureMarkerSchema>;

const MISSED_RUN_ID_LIMIT = 200;

export interface AppendCostLedgerEntryInput {
  readonly runId: string;
  readonly bookId: string;
  readonly chapterNumber?: number;
  readonly productionStatus: CostLedgerEntryV1["productionStatus"];
  readonly pipelineStatus?: CostLedgerEntryV1["pipelineStatus"];
  readonly stopReason?: CostLedgerEntryV1["stopReason"];
  readonly tokenUsage?: CostLedgerTokenUsageV1;
  readonly usageExtra?: Readonly<Record<string, unknown>>;
  readonly inkosVersion: string;
  readonly model: string;
  readonly overrideModels?: ReadonlyArray<string>;
  readonly cost?: CostLedgerCostV1;
  readonly costUnavailableReason?: CostUnavailableReason;
}

export type CostLedgerInspection =
  | { readonly status: "ok"; readonly entries: ReadonlyArray<CostLedgerEntryV1> }
  | {
      readonly status: "torn_tail";
      /** All fully valid entries before the torn tail. */
      readonly entries: ReadonlyArray<CostLedgerEntryV1>;
      readonly tornBytes: number;
    }
  | { readonly status: "corrupt"; readonly error: CostLedgerError };

export type RepairTornTailResult =
  | { readonly repaired: true; readonly backupPath: string; readonly removedBytes: number }
  | { readonly repaired: false; readonly reason: "not_torn" };

interface ResolvedLedgerPaths {
  readonly bookId: string;
  readonly ledgerPath: string;
  readonly failuresPath: string;
}

interface ParsedLedger {
  readonly entries: CostLedgerEntryV1[];
  readonly validByteLength: number;
  readonly tornBytes: number;
}

export interface CostLedgerStoreOptions {
  readonly now?: () => Date;
  readonly entryIdFactory?: () => string;
  readonly atomicReplace?: (sourcePath: string, destinationPath: string) => Promise<void>;
}

export class CostLedgerStore {
  private readonly now: () => Date;
  private readonly entryIdFactory: () => string;
  private readonly atomicReplace: (sourcePath: string, destinationPath: string) => Promise<void>;

  constructor(
    private readonly projectRoot: string,
    options: CostLedgerStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.entryIdFactory = options.entryIdFactory ?? randomUUID;
    this.atomicReplace = options.atomicReplace ?? rename;
  }

  /**
   * Appends one entry. The whole write path — tail integrity check, runId
   * dedup, seq assignment, single O_APPEND write, fsync — runs inside one
   * book-level `.write.lock` critical section (TOCTOU protection, finding C1).
   * The lock is the existing cross-process StateManager lock file (C2).
   */
  async append(bookId: string, input: AppendCostLedgerEntryInput): Promise<CostLedgerEntryV1> {
    const paths = this.resolvePaths(bookId);
    if (input.bookId !== paths.bookId) {
      // Three-way bookId binding: path == entry == run context (finding B2).
      throw new CostLedgerError(
        "LEDGER_BOOK_ID_MISMATCH",
        paths.bookId,
        "Entry bookId " + JSON.stringify(input.bookId) + " does not match target book " + JSON.stringify(paths.bookId),
        { runId: input.runId },
      );
    }

    return this.withBookLock(paths.bookId, input.runId, async () => {
      const parsed = await this.parseLedgerFile(paths, { forWrite: true });
      if (parsed.entries.some((entry) => entry.runId === input.runId)) {
        throw new CostLedgerError(
          "LEDGER_DUPLICATE_RUN",
          paths.bookId,
          "Ledger already contains an entry for runId " + JSON.stringify(input.runId),
          { runId: input.runId },
        );
      }

      const lastSeq = parsed.entries.length > 0 ? parsed.entries[parsed.entries.length - 1].seq : 0;
      const candidate = {
        schemaVersion: COST_LEDGER_SCHEMA_VERSION,
        seq: lastSeq + 1,
        entryId: this.entryIdFactory(),
        runId: input.runId,
        bookId: paths.bookId,
        ...(input.chapterNumber !== undefined ? { chapterNumber: input.chapterNumber } : {}),
        recordedAt: this.now().toISOString(),
        productionStatus: input.productionStatus,
        ...(input.pipelineStatus !== undefined ? { pipelineStatus: input.pipelineStatus } : {}),
        ...(input.stopReason !== undefined ? { stopReason: input.stopReason } : {}),
        ...(input.tokenUsage !== undefined ? { tokenUsage: input.tokenUsage } : {}),
        ...(input.usageExtra !== undefined && Object.keys(input.usageExtra).length > 0
          ? { usageExtra: { ...input.usageExtra } }
          : {}),
        inkosVersion: input.inkosVersion,
        model: input.model,
        ...(input.overrideModels !== undefined && input.overrideModels.length > 0
          ? { overrideModels: [...input.overrideModels] }
          : {}),
        ...(input.cost !== undefined ? { cost: input.cost } : {}),
        ...(input.costUnavailableReason !== undefined
          ? { costUnavailableReason: input.costUnavailableReason }
          : {}),
      };

      const validated = CostLedgerEntrySchema.safeParse(candidate);
      if (!validated.success) {
        throw new CostLedgerError(
          "LEDGER_INVALID_SCHEMA",
          paths.bookId,
          "Refusing to append a ledger entry that fails schema validation",
          { runId: input.runId, cause: validated.error },
        );
      }

      const line = JSON.stringify(validated.data) + "\n";
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        await mkdir(dirname(paths.ledgerPath), { recursive: true });
        handle = await open(paths.ledgerPath, "a");
        await handle.write(line, null, "utf-8");
        await handle.sync();
      } catch (error) {
        throw new CostLedgerError(
          "LEDGER_WRITE_FAILED",
          paths.bookId,
          "Failed to append to " + COST_LEDGER_RELATIVE_PATH + " for book " + JSON.stringify(paths.bookId),
          { runId: input.runId, cause: error },
        );
      } finally {
        await handle?.close().catch(() => undefined);
      }
      return validated.data;
    });
  }

  /** Strict read: throws a typed CostLedgerError on any corruption. */
  async read(bookId: string): Promise<ReadonlyArray<CostLedgerEntryV1>> {
    const paths = this.resolvePaths(bookId);
    const parsed = await this.parseLedgerFile(paths, { forWrite: false });
    return parsed.entries;
  }

  /** Non-throwing health view used by aggregation (finding D4). */
  async inspect(bookId: string): Promise<CostLedgerInspection> {
    let paths: ResolvedLedgerPaths;
    try {
      paths = this.resolvePaths(bookId);
    } catch (error) {
      return { status: "corrupt", error: error as CostLedgerError };
    }
    try {
      const parsed = await this.parseLedgerFile(paths, { forWrite: false });
      return { status: "ok", entries: parsed.entries };
    } catch (error) {
      if (error instanceof CostLedgerError && error.code === "LEDGER_TORN_TAIL") {
        const salvage = await this.parseValidPrefix(paths);
        return { status: "torn_tail", entries: salvage.entries, tornBytes: salvage.tornBytes };
      }
      const wrapped =
        error instanceof CostLedgerError
          ? error
          : new CostLedgerError("LEDGER_READ_FAILED", paths.bookId, "Failed to inspect cost ledger", {
              cause: error,
            });
      return { status: "corrupt", error: wrapped };
    }
  }

  /**
   * Controlled torn-tail recovery (finding D2). Explicit human-invoked only —
   * never called automatically. Preserves evidence: torn bytes are moved to
   * `commercial/cost-ledger.torn.<seq>.bak` before the ledger is truncated
   * back to the last fully valid line via temp-file + atomic rename.
   */
  async repairTornTail(bookId: string): Promise<RepairTornTailResult> {
    const paths = this.resolvePaths(bookId);
    return this.withBookLock(paths.bookId, undefined, async () => {
      const raw = await this.readRaw(paths);
      const salvage = this.parsePrefix(paths, raw);
      if (salvage.tornBytes === 0) return { repaired: false, reason: "not_torn" };

      const backupPath = safeChildPath(
        this.bookRoot(paths.bookId),
        COST_LEDGER_TORN_BACKUP_PREFIX + (salvage.entries.length > 0 ? salvage.entries[salvage.entries.length - 1].seq : 0) + "." + Date.now() + ".bak",
      );
      const tornBytes = raw.subarray(salvage.validByteLength);
      let backupHandle: Awaited<ReturnType<typeof open>> | undefined;
      let temporaryPath: string | undefined;
      try {
        backupHandle = await open(backupPath, "wx");
        await backupHandle.write(tornBytes);
        await backupHandle.sync();
        await backupHandle.close();
        backupHandle = undefined;

        temporaryPath = safeChildPath(
          dirname(paths.ledgerPath),
          ".cost-ledger.repair." + process.pid + "." + randomUUID() + ".tmp",
        );
        const prefix = raw.subarray(0, salvage.validByteLength);
        const tempHandle = await open(temporaryPath, "wx");
        try {
          await tempHandle.write(prefix);
          await tempHandle.sync();
        } finally {
          await tempHandle.close();
        }
        await this.atomicReplace(temporaryPath, paths.ledgerPath);
        temporaryPath = undefined;
        return { repaired: true, backupPath, removedBytes: tornBytes.byteLength };
      } catch (error) {
        await backupHandle?.close().catch(() => undefined);
        if (temporaryPath !== undefined) await rm(temporaryPath, { force: true }).catch(() => undefined);
        throw new CostLedgerError(
          "LEDGER_REPAIR_FAILED",
          paths.bookId,
          "Failed to repair torn cost ledger tail for book " + JSON.stringify(paths.bookId),
          { cause: error },
        );
      }
    });
  }

  /** Best-effort durable failure marker (anti silent-loss floor, finding D4). */
  async recordWriteFailure(bookId: string, failure: { readonly errorCode: string; readonly runId?: string }): Promise<CostLedgerFailureMarkerV1 | undefined> {
    try {
      const paths = this.resolvePaths(bookId);
      const existing = await this.readFailureMarker(bookId);
      const missed = existing?.missedRunIds ?? [];
      const nextMissed =
        failure.runId !== undefined && !missed.includes(failure.runId)
          ? [...missed, failure.runId].slice(-MISSED_RUN_ID_LIMIT)
          : [...missed];
      const marker: CostLedgerFailureMarkerV1 = {
        schemaVersion: COST_LEDGER_SCHEMA_VERSION,
        failureCount: (existing?.failureCount ?? 0) + 1,
        lastErrorCode: failure.errorCode,
        lastFailedAt: this.now().toISOString(),
        missedRunIds: nextMissed,
      };
      await this.writeFailureMarker(paths, marker);
      return marker;
    } catch {
      // Final fallback is the caller's logger; the marker itself is best-effort.
      return undefined;
    }
  }

  async readFailureMarker(bookId: string): Promise<CostLedgerFailureMarkerV1 | undefined> {
    const paths = this.resolvePaths(bookId);
    let raw: string;
    try {
      raw = await readFile(paths.failuresPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return undefined;
      throw new CostLedgerError("LEDGER_READ_FAILED", paths.bookId, "Failed to read ledger failure marker", {
        cause: error,
      });
    }
    try {
      return CostLedgerFailureMarkerSchema.parse(JSON.parse(raw));
    } catch (error) {
      throw new CostLedgerError("LEDGER_INVALID_JSON", paths.bookId, "Ledger failure marker is corrupt", {
        cause: error,
      });
    }
  }

  /** Explicit human acknowledgement after repair/backfill; never automatic. */
  async clearFailureMarker(bookId: string): Promise<void> {
    const paths = this.resolvePaths(bookId);
    await rm(paths.failuresPath, { force: true });
  }

  private bookRoot(bookId: string): string {
    return safeChildPath(safeChildPath(this.projectRoot, "books"), bookId);
  }

  private resolvePaths(bookId: string): ResolvedLedgerPaths {
    try {
      const safeBookId = assertSafeBookId(bookId, "costLedger.bookId");
      const bookRoot = this.bookRoot(safeBookId);
      return {
        bookId: safeBookId,
        ledgerPath: safeChildPath(bookRoot, COST_LEDGER_RELATIVE_PATH),
        failuresPath: safeChildPath(bookRoot, COST_LEDGER_FAILURES_RELATIVE_PATH),
      };
    } catch (error) {
      throw new CostLedgerError(
        "LEDGER_INVALID_PATH",
        typeof bookId === "string" ? bookId : String(bookId),
        "Invalid cost ledger path for bookId " + JSON.stringify(bookId),
        { cause: error },
      );
    }
  }

  private async withBookLock<T>(bookId: string, runId: string | undefined, action: () => Promise<T>): Promise<T> {
    let releaseLock: (() => Promise<void>) | undefined;
    try {
      releaseLock = await new StateManager(this.projectRoot).acquireBookLock(bookId);
    } catch (error) {
      if (error instanceof BookWriteLockError) throw error;
      throw new CostLedgerError(
        "LEDGER_WRITE_FAILED",
        bookId,
        "Failed to acquire the write lock for book " + JSON.stringify(bookId),
        { ...(runId !== undefined ? { runId } : {}), cause: error },
      );
    }
    try {
      return await action();
    } finally {
      await releaseLock();
    }
  }

  private async readRaw(paths: ResolvedLedgerPaths): Promise<Buffer> {
    try {
      return await readFile(paths.ledgerPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return Buffer.alloc(0);
      throw new CostLedgerError(
        "LEDGER_READ_FAILED",
        paths.bookId,
        "Failed to read " + COST_LEDGER_RELATIVE_PATH + " for book " + JSON.stringify(paths.bookId),
        { cause: error },
      );
    }
  }

  /**
   * Torn-tail decision rules (frozen in design §7, finding D1):
   * - empty file -> valid empty ledger
   * - file not ending in "\n" -> LEDGER_TORN_TAIL (even if the tail parses)
   * - last line fails JSON.parse, all previous lines valid -> LEDGER_TORN_TAIL
   * - any non-last line fails JSON.parse -> LEDGER_INVALID_JSON
   * - parseable line with schemaVersion !== 1 -> LEDGER_UNSUPPORTED_VERSION
   * - parseable line failing schema -> LEDGER_INVALID_SCHEMA
   * - entry bookId mismatch -> LEDGER_BOOK_ID_MISMATCH
   * - seq not strictly ascending -> LEDGER_INVALID_SCHEMA
   */
  private parsePrefix(paths: ResolvedLedgerPaths, raw: Buffer): ParsedLedger {
    const text = raw.toString("utf-8");
    if (text.length === 0) return { entries: [], validByteLength: 0, tornBytes: 0 };

    const endsWithNewline = text.endsWith("\n");
    const body = endsWithNewline ? text.slice(0, -1) : text;
    const lines = body.length > 0 ? body.split("\n") : [];
    const entries: CostLedgerEntryV1[] = [];
    let validByteLength = 0;

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const isLastLine = index === lines.length - 1;
      const lineNumber = index + 1;

      let parsedLine: unknown;
      try {
        parsedLine = JSON.parse(line);
      } catch (cause) {
        if (isLastLine) {
          return { entries, validByteLength, tornBytes: raw.byteLength - validByteLength };
        }
        throw new CostLedgerError(
          "LEDGER_INVALID_JSON",
          paths.bookId,
          "Cost ledger line " + lineNumber + " is not valid JSON",
          { lineNumber, cause },
        );
      }

      if (isLastLine && !endsWithNewline) {
        // A truncated-but-parseable tail is still torn: completed writes
        // always end with "\n" (single-write append invariant).
        return { entries, validByteLength, tornBytes: raw.byteLength - validByteLength };
      }

      const version = (parsedLine as { schemaVersion?: unknown } | null)?.schemaVersion;
      if (version !== COST_LEDGER_SCHEMA_VERSION) {
        throw new CostLedgerError(
          "LEDGER_UNSUPPORTED_VERSION",
          paths.bookId,
          "Cost ledger line " + lineNumber + " has unsupported schemaVersion " + JSON.stringify(version),
          { lineNumber },
        );
      }

      const validated = CostLedgerEntrySchema.safeParse(parsedLine);
      if (!validated.success) {
        throw new CostLedgerError(
          "LEDGER_INVALID_SCHEMA",
          paths.bookId,
          "Cost ledger line " + lineNumber + " failed schema validation",
          { lineNumber, cause: validated.error },
        );
      }
      const entry = validated.data;
      if (entry.bookId !== paths.bookId) {
        throw new CostLedgerError(
          "LEDGER_BOOK_ID_MISMATCH",
          paths.bookId,
          "Cost ledger line " + lineNumber + " belongs to book " + JSON.stringify(entry.bookId),
          { lineNumber, runId: entry.runId },
        );
      }
      const lastSeq = entries.length > 0 ? entries[entries.length - 1].seq : 0;
      if (entry.seq <= lastSeq) {
        throw new CostLedgerError(
          "LEDGER_INVALID_SCHEMA",
          paths.bookId,
          "Cost ledger line " + lineNumber + " breaks seq monotonicity (" + lastSeq + " -> " + entry.seq + ")",
          { lineNumber, runId: entry.runId },
        );
      }

      entries.push(entry);
      validByteLength += Buffer.byteLength(line, "utf-8") + 1;
    }

    return { entries, validByteLength, tornBytes: 0 };
  }

  private async parseValidPrefix(paths: ResolvedLedgerPaths): Promise<ParsedLedger> {
    return this.parsePrefix(paths, await this.readRaw(paths));
  }

  private async parseLedgerFile(paths: ResolvedLedgerPaths, options: { readonly forWrite: boolean }): Promise<ParsedLedger> {
    const parsed = await this.parseValidPrefix(paths);
    if (parsed.tornBytes > 0) {
      throw new CostLedgerError(
        "LEDGER_TORN_TAIL",
        paths.bookId,
        "Cost ledger for book " + JSON.stringify(paths.bookId) + " has a torn tail (" + parsed.tornBytes + " bytes). " +
          (options.forWrite
            ? "Appending is blocked until repairTornTail() is explicitly run."
            : "Run repairTornTail() to quarantine the torn bytes."),
      );
    }
    return parsed;
  }

  private async writeFailureMarker(paths: ResolvedLedgerPaths, marker: CostLedgerFailureMarkerV1): Promise<void> {
    const directory = dirname(paths.failuresPath);
    const temporaryPath = safeChildPath(directory, ".cost-ledger-failures." + process.pid + "." + randomUUID() + ".tmp");
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      await mkdir(directory, { recursive: true });
      handle = await open(temporaryPath, "wx");
      await handle.writeFile(JSON.stringify(marker, null, 2) + "\n", "utf-8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.atomicReplace(temporaryPath, paths.failuresPath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new CostLedgerError("LEDGER_WRITE_FAILED", paths.bookId, "Failed to write ledger failure marker", {
        cause: error,
      });
    }
  }
}

// === Read-side aggregation (pure; never persisted — single source of truth stays in the JSONL) ===


export interface CostLedgerAggregate {
  readonly entryCount: number;
  readonly tokenTotals: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
  /** Exact decimal totals per currency (mixed currencies never collapse). */
  readonly costTotals: Readonly<Record<string, string>>;
  readonly entriesWithCost: number;
  readonly entriesWithoutCost: number;
  readonly approximateCostEntries: number;
  readonly byProductionStatus: Readonly<Record<string, number>>;
  readonly byStopReason: Readonly<Record<string, number>>;
  readonly byCostUnavailableReason: Readonly<Record<string, number>>;
}

export function aggregateCostLedgerEntries(entries: ReadonlyArray<CostLedgerEntryV1>): CostLedgerAggregate {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  let entriesWithCost = 0;
  let approximateCostEntries = 0;
  const costTotals: Record<string, string> = {};
  const byProductionStatus: Record<string, number> = {};
  const byStopReason: Record<string, number> = {};
  const byCostUnavailableReason: Record<string, number> = {};

  for (const entry of entries) {
    if (entry.tokenUsage) {
      promptTokens += entry.tokenUsage.promptTokens;
      completionTokens += entry.tokenUsage.completionTokens;
      totalTokens += entry.tokenUsage.totalTokens;
    }
    if (entry.cost) {
      entriesWithCost += 1;
      if (entry.cost.approximate) approximateCostEntries += 1;
      costTotals[entry.cost.currency] = addDecimalStrings(
        costTotals[entry.cost.currency] ?? "0",
        entry.cost.totalCost,
      );
    } else if (entry.costUnavailableReason !== undefined) {
      byCostUnavailableReason[entry.costUnavailableReason] =
        (byCostUnavailableReason[entry.costUnavailableReason] ?? 0) + 1;
    }
    byProductionStatus[entry.productionStatus] = (byProductionStatus[entry.productionStatus] ?? 0) + 1;
    if (entry.stopReason !== undefined) {
      byStopReason[entry.stopReason] = (byStopReason[entry.stopReason] ?? 0) + 1;
    }
  }

  return {
    entryCount: entries.length,
    tokenTotals: { promptTokens, completionTokens, totalTokens },
    costTotals,
    entriesWithCost,
    entriesWithoutCost: entries.length - entriesWithCost,
    approximateCostEntries,
    byProductionStatus,
    byStopReason,
    byCostUnavailableReason,
  };
}

export interface CostLedgerHealth {
  readonly ledger:
    | { readonly status: "ok" }
    | { readonly status: "torn_tail"; readonly tornBytes: number }
    | { readonly status: "corrupt"; readonly errorCode: CostLedgerErrorCode; readonly message: string };
  readonly pendingWriteFailures?: CostLedgerFailureMarkerV1;
}

export interface BookCostLedgerSummary {
  readonly bookId: string;
  /** Aggregate over the valid entries that could be read (valid prefix for torn tails). */
  readonly aggregate: CostLedgerAggregate;
  /** Loud, unmissable health signal (red-team finding D4). */
  readonly health: CostLedgerHealth;
}

export async function summarizeBookCostLedger(store: CostLedgerStore, bookId: string): Promise<BookCostLedgerSummary> {
  const inspection = await store.inspect(bookId);
  let marker: CostLedgerFailureMarkerV1 | undefined;
  try {
    marker = await store.readFailureMarker(bookId);
  } catch (error) {
    return {
      bookId,
      aggregate: aggregateCostLedgerEntries(inspection.status === "corrupt" ? [] : inspection.entries),
      health: {
        ledger: {
          status: "corrupt",
          errorCode: error instanceof CostLedgerError ? error.code : "LEDGER_READ_FAILED",
          message: error instanceof Error ? error.message : String(error),
        },
      },
    };
  }

  const ledgerHealth: CostLedgerHealth["ledger"] =
    inspection.status === "ok"
      ? { status: "ok" }
      : inspection.status === "torn_tail"
        ? { status: "torn_tail", tornBytes: inspection.tornBytes }
        : { status: "corrupt", errorCode: inspection.error.code, message: inspection.error.message };

  return {
    bookId,
    aggregate: aggregateCostLedgerEntries(inspection.status === "corrupt" ? [] : inspection.entries),
    health: {
      ledger: ledgerHealth,
      ...(marker !== undefined ? { pendingWriteFailures: marker } : {}),
    },
  };
}

export interface ProjectCostLedgerSummary {
  readonly books: ReadonlyArray<BookCostLedgerSummary>;
  readonly combined: CostLedgerAggregate;
  readonly booksWithIssues: number;
}

/** Cross-book totals are computed in memory only; per-book files stay isolated. */
export async function summarizeProjectCostLedger(
  store: CostLedgerStore,
  bookIds: ReadonlyArray<string>,
): Promise<ProjectCostLedgerSummary> {
  const books: BookCostLedgerSummary[] = [];
  for (const bookId of bookIds) {
    books.push(await summarizeBookCostLedger(store, bookId));
  }
  const combinedTokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  const combinedCost: Record<string, string> = {};
  let entryCount = 0;
  let entriesWithCost = 0;
  let approximateCostEntries = 0;
  const byProductionStatus: Record<string, number> = {};
  const byStopReason: Record<string, number> = {};
  const byCostUnavailableReason: Record<string, number> = {};
  for (const book of books) {
    entryCount += book.aggregate.entryCount;
    entriesWithCost += book.aggregate.entriesWithCost;
    approximateCostEntries += book.aggregate.approximateCostEntries;
    combinedTokens.promptTokens += book.aggregate.tokenTotals.promptTokens;
    combinedTokens.completionTokens += book.aggregate.tokenTotals.completionTokens;
    combinedTokens.totalTokens += book.aggregate.tokenTotals.totalTokens;
    for (const [currency, amount] of Object.entries(book.aggregate.costTotals)) {
      combinedCost[currency] = addDecimalStrings(combinedCost[currency] ?? "0", amount);
    }
    for (const [key, count] of Object.entries(book.aggregate.byProductionStatus)) {
      byProductionStatus[key] = (byProductionStatus[key] ?? 0) + count;
    }
    for (const [key, count] of Object.entries(book.aggregate.byStopReason)) {
      byStopReason[key] = (byStopReason[key] ?? 0) + count;
    }
    for (const [key, count] of Object.entries(book.aggregate.byCostUnavailableReason)) {
      byCostUnavailableReason[key] = (byCostUnavailableReason[key] ?? 0) + count;
    }
  }
  return {
    books,
    combined: {
      entryCount,
      tokenTotals: combinedTokens,
      costTotals: combinedCost,
      entriesWithCost,
      entriesWithoutCost: entryCount - entriesWithCost,
      approximateCostEntries,
      byProductionStatus,
      byStopReason,
      byCostUnavailableReason,
    },
    booksWithIssues: books.filter(
      (book) => book.health.ledger.status !== "ok" || book.health.pendingWriteFailures !== undefined,
    ).length,
  };
}
