import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  COST_LEDGER_RELATIVE_PATH,
  CostLedgerEntrySchema,
  CostLedgerError,
  CostLedgerStore,
  aggregateCostLedgerEntries,
  summarizeBookCostLedger,
  summarizeProjectCostLedger,
  type AppendCostLedgerEntryInput,
  type CostLedgerEntryV1,
} from "../commercial/cost-ledger.js";
import { BookWriteLockError, StateManager } from "../state/manager.js";

const BOOK_ID = "book-alpha";

function appendInput(overrides: Partial<AppendCostLedgerEntryInput> = {}): AppendCostLedgerEntryInput {
  return {
    runId: "run-" + Math.random().toString(36).slice(2),
    bookId: BOOK_ID,
    chapterNumber: 1,
    productionStatus: "awaiting_manual_review",
    pipelineStatus: "ready-for-review",
    tokenUsage: { promptTokens: 67_637, completionTokens: 10_000, totalTokens: 77_637 },
    inkosVersion: "1.7.0",
    model: "test-model",
    ...overrides,
  };
}

describe("cost ledger store", () => {
  let projectRoot: string;
  let store: CostLedgerStore;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-cost-ledger-"));
    store = new CostLedgerStore(projectRoot);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  function ledgerPath(bookId = BOOK_ID): string {
    return join(projectRoot, "books", bookId, COST_LEDGER_RELATIVE_PATH);
  }

  async function expectCode(promise: Promise<unknown>, code: string): Promise<CostLedgerError> {
    const error = await promise.then(
      () => undefined,
      (caught) => caught as CostLedgerError,
    );
    expect(error, "expected a CostLedgerError with code " + code).toBeInstanceOf(CostLedgerError);
    expect((error as CostLedgerError).code).toBe(code);
    return error as CostLedgerError;
  }

  describe("append and read", () => {
    it("round-trips entries with monotonic seq and stable order", async () => {
      const first = await store.append(BOOK_ID, appendInput({ runId: "run-1" }));
      const second = await store.append(BOOK_ID, appendInput({ runId: "run-2", chapterNumber: 2 }));
      expect(first.seq).toBe(1);
      expect(second.seq).toBe(2);

      const entries = await store.read(BOOK_ID);
      expect(entries.map((entry) => entry.runId)).toEqual(["run-1", "run-2"]);
      expect(entries[1].chapterNumber).toBe(2);
      expect(entries[0].schemaVersion).toBe(1);
    });

    it("keeps seq and file order authoritative when the wall clock moves backward", async () => {
      const timestamps = [
        new Date("2026-07-17T02:00:00.000Z"),
        new Date("2026-07-17T01:00:00.000Z"),
      ];
      const rollbackStore = new CostLedgerStore(projectRoot, { now: () => timestamps.shift()! });
      await rollbackStore.append(BOOK_ID, appendInput({ runId: "run-before-rollback" }));
      await rollbackStore.append(BOOK_ID, appendInput({ runId: "run-after-rollback" }));

      const entries = await rollbackStore.read(BOOK_ID);
      expect(entries.map(({ seq, runId }) => ({ seq, runId }))).toEqual([
        { seq: 1, runId: "run-before-rollback" },
        { seq: 2, runId: "run-after-rollback" },
      ]);
      expect(entries[1].recordedAt < entries[0].recordedAt).toBe(true);
    });

    it("keeps the file valid JSONL with one line per entry", async () => {
      await store.append(BOOK_ID, appendInput({ runId: "run-1" }));
      await store.append(BOOK_ID, appendInput({ runId: "run-2" }));
      const raw = await readFile(ledgerPath(), "utf-8");
      expect(raw.endsWith("\n")).toBe(true);
      const lines = raw.slice(0, -1).split("\n");
      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(() => CostLedgerEntrySchema.parse(JSON.parse(line))).not.toThrow();
      }
    });

    it("rejects a duplicate runId (at-most-once)", async () => {
      await store.append(BOOK_ID, appendInput({ runId: "run-1" }));
      await expectCode(store.append(BOOK_ID, appendInput({ runId: "run-1" })), "LEDGER_DUPLICATE_RUN");
      expect(await store.read(BOOK_ID)).toHaveLength(1);
    });

    it("rejects entry bookId that does not match the target book", async () => {
      await expectCode(
        store.append(BOOK_ID, appendInput({ bookId: "book-beta" })),
        "LEDGER_BOOK_ID_MISMATCH",
      );
    });

    it("rejects path traversal bookIds", async () => {
      await expectCode(store.append("../escape", appendInput({ bookId: "../escape" })), "LEDGER_INVALID_PATH");
      await expectCode(store.read("../escape"), "LEDGER_INVALID_PATH");
    });

    it("omits token usage instead of fabricating zeros", async () => {
      const entry = await store.append(
        BOOK_ID,
        appendInput({ tokenUsage: undefined, costUnavailableReason: "token_usage_missing" }),
      );
      expect(entry.tokenUsage).toBeUndefined();
      expect(entry.costUnavailableReason).toBe("token_usage_missing");
    });

    it("preserves unknown upstream usage fields via usageExtra", async () => {
      const entry = await store.append(
        BOOK_ID,
        appendInput({ usageExtra: { cachedPromptTokens: 12 } }),
      );
      expect(entry.usageExtra).toEqual({ cachedPromptTokens: 12 });
    });

    it("only ever writes under the book commercial directory", async () => {
      await mkdir(join(projectRoot, "books", BOOK_ID), { recursive: true });
      const storyFile = join(projectRoot, "books", BOOK_ID, "story-state.json");
      await writeFile(storyFile, "{\"authoritative\":true}\n", "utf-8");
      await store.append(BOOK_ID, appendInput());
      expect(await readFile(storyFile, "utf-8")).toBe("{\"authoritative\":true}\n");
      const { readdir } = await import("node:fs/promises");
      const bookDirEntries = await readdir(join(projectRoot, "books", BOOK_ID));
      expect(bookDirEntries.sort()).toEqual(["commercial", "story-state.json"]);
    });
  });

  describe("schema validation", () => {
    it("rejects negative and non-integer token counts", () => {
      const base = CostLedgerEntrySchema.parse(JSON.parse(JSON.stringify(validEntry())));
      expect(
        CostLedgerEntrySchema.safeParse({ ...base, tokenUsage: { promptTokens: -1, completionTokens: 0, totalTokens: 0 } }).success,
      ).toBe(false);
      expect(
        CostLedgerEntrySchema.safeParse({ ...base, tokenUsage: { promptTokens: 1.5, completionTokens: 0, totalTokens: 2 } }).success,
      ).toBe(false);
    });

    it("rejects unsafe token, seq, and chapter integers", () => {
      const unsafe = Number.MAX_SAFE_INTEGER + 1;
      expect(
        CostLedgerEntrySchema.safeParse({
          ...validEntry(),
          tokenUsage: { promptTokens: unsafe, completionTokens: 0, totalTokens: unsafe },
        }).success,
      ).toBe(false);
      expect(CostLedgerEntrySchema.safeParse({ ...validEntry(), seq: unsafe }).success).toBe(false);
      expect(CostLedgerEntrySchema.safeParse({ ...validEntry(), chapterNumber: unsafe }).success).toBe(false);
    });

    it("rejects unknown fields (closed field set)", () => {
      expect(CostLedgerEntrySchema.safeParse({ ...validEntry(), baseUrl: "https://leak.example" }).success).toBe(false);
    });

    it("rejects credential-shaped values only through the closed field set", () => {
      const parsed = CostLedgerEntrySchema.parse(validEntry());
      expect(Object.keys(parsed).sort()).toEqual(
        [
          "bookId",
          "entryId",
          "inkosVersion",
          "model",
          "productionStatus",
          "recordedAt",
          "runId",
          "schemaVersion",
          "seq",
          "tokenUsage",
        ].sort(),
      );
    });
  });

  describe("corruption handling", () => {
    async function seedValidLines(count: number): Promise<CostLedgerEntryV1[]> {
      const results: CostLedgerEntryV1[] = [];
      for (let index = 0; index < count; index++) {
        results.push(await store.append(BOOK_ID, appendInput({ runId: "run-" + (index + 1) })));
      }
      return results;
    }

    it("treats a missing file as a valid empty ledger", async () => {
      expect(await store.read(BOOK_ID)).toEqual([]);
    });

    it("flags a file without trailing newline as torn even when the tail parses", async () => {
      await seedValidLines(1);
      const raw = await readFile(ledgerPath(), "utf-8");
      const parseable = JSON.stringify({ ...JSON.parse(raw.slice(0, -1)), seq: 2, runId: "run-torn", entryId: "torn" });
      await writeFile(ledgerPath(), raw + parseable, "utf-8"); // no trailing \n
      await expectCode(store.read(BOOK_ID), "LEDGER_TORN_TAIL");
    });

    it("flags an unparseable last line as torn and blocks appends", async () => {
      await seedValidLines(2);
      const raw = await readFile(ledgerPath(), "utf-8");
      await writeFile(ledgerPath(), raw + "{\"schemaVersion\":1,\"seq\":3,\"trunc", "utf-8");
      await expectCode(store.read(BOOK_ID), "LEDGER_TORN_TAIL");
      await expectCode(store.append(BOOK_ID, appendInput({ runId: "run-blocked" })), "LEDGER_TORN_TAIL");
    });

    it("flags mid-file garbage as LEDGER_INVALID_JSON, not torn tail", async () => {
      await seedValidLines(1);
      const raw = await readFile(ledgerPath(), "utf-8");
      await writeFile(ledgerPath(), "not json at all\n" + raw, "utf-8");
      await expectCode(store.read(BOOK_ID), "LEDGER_INVALID_JSON");
    });

    it("treats invalid UTF-8 at the tail as torn and repairs exact byte offsets", async () => {
      await seedValidLines(1);
      const healthy = await readFile(ledgerPath());
      const invalidTail = Buffer.from([0xff, 0xfe, 0x80]);
      await writeFile(ledgerPath(), Buffer.concat([healthy, invalidTail]));

      await expectCode(store.read(BOOK_ID), "LEDGER_TORN_TAIL");
      const result = await store.repairTornTail(BOOK_ID);
      expect(result.repaired).toBe(true);
      if (!result.repaired) throw new Error("unreachable");
      expect(result.removedBytes).toBe(invalidTail.byteLength);
      expect(await readFile(result.backupPath)).toEqual(invalidTail);
      expect(await readFile(ledgerPath())).toEqual(healthy);
    });

    it("treats invalid UTF-8 in a complete middle line as LEDGER_INVALID_JSON", async () => {
      await seedValidLines(1);
      const healthy = await readFile(ledgerPath());
      const invalidMiddleLine = Buffer.from([0xff, 0x0a]);
      await writeFile(ledgerPath(), Buffer.concat([invalidMiddleLine, healthy]));
      await expectCode(store.read(BOOK_ID), "LEDGER_INVALID_JSON");
    });

    it("flags schema-invalid complete lines as LEDGER_INVALID_SCHEMA", async () => {
      await seedValidLines(1);
      const bad = JSON.stringify({ ...validEntry(), seq: 2, runId: "run-bad", model: "" });
      await appendRawLine(bad);
      await expectCode(store.read(BOOK_ID), "LEDGER_INVALID_SCHEMA");
    });

    it("flags unsupported schema versions distinctly", async () => {
      await appendRawLine(JSON.stringify({ ...validEntry(), schemaVersion: 99 }));
      await expectCode(store.read(BOOK_ID), "LEDGER_UNSUPPORTED_VERSION");
    });

    it("flags entries from a different book as LEDGER_BOOK_ID_MISMATCH", async () => {
      await appendRawLine(JSON.stringify({ ...validEntry(), bookId: "book-beta" }));
      await expectCode(store.read(BOOK_ID), "LEDGER_BOOK_ID_MISMATCH");
    });

    it("flags seq regressions", async () => {
      await appendRawLine(JSON.stringify({ ...validEntry(), seq: 5 }));
      await appendRawLine(JSON.stringify({ ...validEntry(), seq: 5, runId: "run-again", entryId: "again" }));
      await expectCode(store.read(BOOK_ID), "LEDGER_INVALID_SCHEMA");
    });

    it("never silently truncates or overwrites a corrupt ledger", async () => {
      await seedValidLines(1);
      const raw = await readFile(ledgerPath(), "utf-8");
      const corrupted = raw + "{\"broken";
      await writeFile(ledgerPath(), corrupted, "utf-8");
      await expectCode(store.append(BOOK_ID, appendInput({ runId: "run-x" })), "LEDGER_TORN_TAIL").catch(() => undefined);
      expect(await readFile(ledgerPath(), "utf-8")).toBe(corrupted);
    });

    async function appendRawLine(line: string): Promise<void> {
      await mkdir(join(projectRoot, "books", BOOK_ID, "commercial"), { recursive: true });
      const existing = await readFile(ledgerPath(), "utf-8").catch(() => "");
      await writeFile(ledgerPath(), existing + line + "\n", "utf-8");
    }
  });

  describe("torn tail repair", () => {
    it("returns not_torn on a healthy ledger and changes nothing", async () => {
      await store.append(BOOK_ID, appendInput({ runId: "run-1" }));
      const before = await readFile(ledgerPath(), "utf-8");
      expect(await store.repairTornTail(BOOK_ID)).toEqual({ repaired: false, reason: "not_torn" });
      expect(await readFile(ledgerPath(), "utf-8")).toBe(before);
    });

    it("quarantines torn bytes with evidence and unblocks appends", async () => {
      await store.append(BOOK_ID, appendInput({ runId: "run-1" }));
      const healthy = await readFile(ledgerPath(), "utf-8");
      const tornFragment = "{\"schemaVersion\":1,\"seq\":2,\"half";
      await writeFile(ledgerPath(), healthy + tornFragment, "utf-8");

      const result = await store.repairTornTail(BOOK_ID);
      expect(result.repaired).toBe(true);
      if (!result.repaired) throw new Error("unreachable");
      expect(result.removedBytes).toBe(Buffer.byteLength(tornFragment));
      expect(await readFile(result.backupPath, "utf-8")).toBe(tornFragment);
      expect(await readFile(ledgerPath(), "utf-8")).toBe(healthy);

      const appended = await store.append(BOOK_ID, appendInput({ runId: "run-2" }));
      expect(appended.seq).toBe(2);
    });
  });

  describe("failure marker", () => {
    it("records, increments, dedups runIds and clears explicitly", async () => {
      const first = await store.recordWriteFailure(BOOK_ID, { errorCode: "LEDGER_WRITE_FAILED", runId: "run-1" });
      expect(first?.failureCount).toBe(1);
      const second = await store.recordWriteFailure(BOOK_ID, { errorCode: "LEDGER_TORN_TAIL", runId: "run-1" });
      expect(second?.failureCount).toBe(2);
      expect(second?.missedRunIds).toEqual(["run-1"]);
      expect(second?.lastErrorCode).toBe("LEDGER_TORN_TAIL");

      const marker = await store.readFailureMarker(BOOK_ID);
      expect(marker?.failureCount).toBe(2);
      await store.clearFailureMarker(BOOK_ID);
      expect(await store.readFailureMarker(BOOK_ID)).toBeUndefined();
    });

    it("reports invalid marker JSON instead of silently replacing it", async () => {
      await mkdir(join(projectRoot, "books", BOOK_ID, "commercial"), { recursive: true });
      await writeFile(join(projectRoot, "books", BOOK_ID, "commercial", "cost-ledger-failures.json"), "{broken", "utf-8");
      await expectCode(store.readFailureMarker(BOOK_ID), "LEDGER_INVALID_JSON");
    });

    it("reports marker schema corruption separately from invalid JSON", async () => {
      await mkdir(join(projectRoot, "books", BOOK_ID, "commercial"), { recursive: true });
      await writeFile(
        join(projectRoot, "books", BOOK_ID, "commercial", "cost-ledger-failures.json"),
        JSON.stringify({ schemaVersion: 1, failureCount: "not-a-number" }),
        "utf-8",
      );
      await expectCode(store.readFailureMarker(BOOK_ID), "LEDGER_INVALID_SCHEMA");
    });

    it("returns undefined when the book lock is already occupied", async () => {
      const release = await new StateManager(projectRoot).acquireBookLock(BOOK_ID);
      try {
        await expect(
          store.recordWriteFailure(BOOK_ID, { errorCode: "LEDGER_WRITE_FAILED", runId: "run-locked" }),
        ).resolves.toBeUndefined();
      } finally {
        await release();
      }
      expect(await store.readFailureMarker(BOOK_ID)).toBeUndefined();
    });
  });

  describe("concurrency", () => {
    it("mutually excludes same-book concurrent appends via the book write lock", async () => {
      const results = await Promise.allSettled([
        store.append(BOOK_ID, appendInput({ runId: "run-a" })),
        store.append(BOOK_ID, appendInput({ runId: "run-b" })),
      ]);
      const fulfilled = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(BookWriteLockError);
      expect(await store.read(BOOK_ID)).toHaveLength(1);
    });

    it("does not block appends to a different book", async () => {
      const results = await Promise.allSettled([
        store.append(BOOK_ID, appendInput({ runId: "run-a" })),
        store.append("book-beta", appendInput({ runId: "run-b", bookId: "book-beta" })),
      ]);
      expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    });
  });

  describe("inspection and aggregation", () => {
    it("summarizes a healthy book with token and cost totals", async () => {
      await store.append(
        BOOK_ID,
        appendInput({
          runId: "run-1",
          cost: {
            currency: "CNY",
            promptCost: "0.1690925",
            completionCost: "0.098",
            totalCost: "0.2670925",
            priceTableVersion: "2026-07-17",
            unitPriceSnapshot: { promptPerMTokens: "2.5", completionPerMTokens: "9.8" },
            approximate: false,
          },
        }),
      );
      await store.append(
        BOOK_ID,
        appendInput({ runId: "run-2", productionStatus: "paused", stopReason: "AUDIT_CRITICAL", costUnavailableReason: "model_not_found" }),
      );

      const summary = await summarizeBookCostLedger(store, BOOK_ID);
      expect(summary.health.ledger.status).toBe("ok");
      expect(summary.aggregate.entryCount).toBe(2);
      expect(summary.aggregate.tokenTotals.promptTokens).toBe(67_637 * 2);
      expect(summary.aggregate.costTotals).toEqual({ CNY: "0.2670925" });
      expect(summary.aggregate.entriesWithoutCost).toBe(1);
      expect(summary.aggregate.byStopReason).toEqual({ AUDIT_CRITICAL: 1 });
      expect(summary.aggregate.byCostUnavailableReason).toEqual({ model_not_found: 1 });
    });

    it("surfaces torn tails and pending write failures in health", async () => {
      await store.append(BOOK_ID, appendInput({ runId: "run-1" }));
      const raw = await readFile(ledgerPath(), "utf-8");
      await writeFile(ledgerPath(), raw + "{\"torn", "utf-8");
      await store.recordWriteFailure(BOOK_ID, { errorCode: "LEDGER_TORN_TAIL", runId: "run-2" });

      const summary = await summarizeBookCostLedger(store, BOOK_ID);
      expect(summary.health.ledger.status).toBe("torn_tail");
      expect(summary.aggregate.entryCount).toBe(1);
      expect(summary.health.pendingWriteFailures?.missedRunIds).toEqual(["run-2"]);
    });

    it("aggregates across books in memory only and counts unhealthy books", async () => {
      await store.append(BOOK_ID, appendInput({ runId: "run-1" }));
      await store.append("book-beta", appendInput({ runId: "run-2", bookId: "book-beta" }));
      const betaLedger = join(projectRoot, "books", "book-beta", COST_LEDGER_RELATIVE_PATH);
      await writeFile(betaLedger, (await readFile(betaLedger, "utf-8")) + "{\"torn", "utf-8");

      const summary = await summarizeProjectCostLedger(store, [BOOK_ID, "book-beta"]);
      expect(summary.combined.entryCount).toBe(2);
      expect(summary.booksWithIssues).toBe(1);
      const { access } = await import("node:fs/promises");
      await expect(access(join(projectRoot, "cost-summary.json"))).rejects.toThrow();
    });

    it("handles mixed currencies without collapsing them", () => {
      const entryA = { ...validEntry(), cost: costOf("CNY", "1.5") };
      const entryB = { ...validEntry(), seq: 2, runId: "run-2", entryId: "e2", cost: costOf("USD", "0.25") };
      const aggregate = aggregateCostLedgerEntries([
        CostLedgerEntrySchema.parse(entryA),
        CostLedgerEntrySchema.parse(entryB),
      ]);
      expect(aggregate.costTotals).toEqual({ CNY: "1.5", USD: "0.25" });
    });

    it("marks token totals inexact when safe entries overflow in aggregate", () => {
      const first = CostLedgerEntrySchema.parse({
        ...validEntry(),
        tokenUsage: {
          promptTokens: Number.MAX_SAFE_INTEGER,
          completionTokens: 1,
          totalTokens: Number.MAX_SAFE_INTEGER,
        },
      });
      const second = CostLedgerEntrySchema.parse({
        ...validEntry(),
        seq: 2,
        runId: "run-2",
        entryId: "entry-2",
        tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 1 },
      });
      const aggregate = aggregateCostLedgerEntries([first, second]);
      expect(aggregate.tokenTotals.exact).toBe(false);
      expect(aggregate.tokenTotals.promptTokens).toBe(Number.MAX_SAFE_INTEGER + 1);
    });
  });

  function validEntry(): Record<string, unknown> {
    return {
      schemaVersion: 1,
      seq: 1,
      entryId: "entry-1",
      runId: "run-1",
      bookId: BOOK_ID,
      recordedAt: new Date("2026-07-17T00:00:00.000Z").toISOString(),
      productionStatus: "awaiting_manual_review",
      tokenUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      inkosVersion: "1.7.0",
      model: "test-model",
    };
  }

  function costOf(currency: string, totalCost: string) {
    return {
      currency,
      promptCost: totalCost,
      completionCost: "0",
      totalCost,
      priceTableVersion: "v1",
      unitPriceSnapshot: { promptPerMTokens: "1", completionPerMTokens: "1" },
      approximate: false,
    };
  }
});
