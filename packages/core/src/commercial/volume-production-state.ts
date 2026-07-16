import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import type { ChapterPipelineResult } from "../pipeline/runner.js";
import { BookWriteLockError, StateManager } from "../state/manager.js";
import { assertSafeBookId, isSafeBookId } from "../utils/book-id.js";
import { safeChildPath } from "../utils/path-safety.js";
import type { VolumeProductionPolicyV1 } from "./volume-production-policy.js";

export const VOLUME_PRODUCTION_STATE_SCHEMA_VERSION = 1 as const;
export const VOLUME_PRODUCTION_STATE_RELATIVE_PATH = "commercial/volume-production-state.json";

export const VolumeChapterProductionStatusSchema = z.enum([
  "running",
  "awaiting_manual_review",
  "approved",
  "revision_requested",
  "rejected",
  "paused",
]);
export type VolumeChapterProductionStatus = z.infer<typeof VolumeChapterProductionStatusSchema>;

export const VolumeBookProductionStatusSchema = z.enum(["active", "paused"]);
export type VolumeBookProductionStatus = z.infer<typeof VolumeBookProductionStatusSchema>;

export const VolumeManualReviewDecisionSchema = z.enum([
  "approve",
  "reject",
  "request_revision",
]);
export type VolumeManualReviewDecision = z.infer<typeof VolumeManualReviewDecisionSchema>;

export const VolumePipelineStatusSchema = z.enum([
  "ready-for-review",
  "audit-failed",
  "state-degraded",
]);
export type VolumePipelineStatus = z.infer<typeof VolumePipelineStatusSchema>;

export const VolumeProductionStopReasonSchema = z.enum([
  "PRODUCTION_TIMEOUT",
  "PRODUCTION_ABORTED",
  "PRODUCTION_PIPELINE_FAILED",
  "CHAPTER_NUMBER_MISMATCH",
  "STATE_DEGRADED",
  "AUDIT_PARSE_FAILED",
  "AUDIT_CRITICAL",
  "LENGTH_OUT_OF_POLICY",
  "WARNING_OVERRIDE_REQUIRED",
  "AUDIT_FAILED",
]);
export type VolumeProductionStopReason = z.infer<typeof VolumeProductionStopReasonSchema>;

export const VolumeProductionStateErrorCodeSchema = z.enum([
  "PRODUCTION_STATE_INVALID_PATH",
  "PRODUCTION_STATE_INVALID_JSON",
  "PRODUCTION_STATE_INVALID_SCHEMA",
  "PRODUCTION_STATE_UNSUPPORTED_VERSION",
  "PRODUCTION_STATE_BOOK_ID_MISMATCH",
  "PRODUCTION_STATE_READ_FAILED",
  "PRODUCTION_STATE_WRITE_FAILED",
  "PRODUCTION_ALREADY_RUNNING",
  "PRODUCTION_BOOK_PAUSED",
  "PRODUCTION_INVALID_TRANSITION",
]);
export type VolumeProductionStateErrorCode = z.infer<typeof VolumeProductionStateErrorCodeSchema>;

export class VolumeProductionStateError extends Error {
  readonly relativePath = VOLUME_PRODUCTION_STATE_RELATIVE_PATH;

  constructor(
    readonly code: VolumeProductionStateErrorCode,
    readonly bookId: string,
    message: string,
    readonly options: {
      readonly chapterNumber?: number;
      readonly runId?: string;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "VolumeProductionStateError";
  }

  get chapterNumber(): number | undefined {
    return this.options.chapterNumber;
  }

  get runId(): string | undefined {
    return this.options.runId;
  }

  get cause(): unknown {
    return this.options.cause;
  }
}

const SafeBookIdSchema = z.string().refine(isSafeBookId, "Invalid bookId");
const IsoDateSchema = z.string().datetime();

export const VolumeLengthGateSchema = z.object({
  target: z.number().int().min(1),
  softMin: z.number().int().min(1),
  softMax: z.number().int().min(1),
  actual: z.number().int().min(0),
  passed: z.boolean(),
}).strict().superRefine((gate, ctx) => {
  const expectedPassed = gate.actual >= gate.softMin && gate.actual <= gate.softMax;
  if (gate.passed !== expectedPassed) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "lengthGate.passed must match actual within softMin/softMax",
      path: ["passed"],
    });
  }
});
export type VolumeLengthGateV1 = z.infer<typeof VolumeLengthGateSchema>;

export const VolumeAuditGateSchema = z.object({
  pipelineStatus: VolumePipelineStatusSchema,
  parseFailed: z.boolean(),
  warningCount: z.number().int().min(0),
  criticalCount: z.number().int().min(0),
  warningOnly: z.boolean(),
}).strict().superRefine((gate, ctx) => {
  const expectedWarningOnly = !gate.parseFailed && gate.warningCount > 0 && gate.criticalCount === 0;
  if (gate.warningOnly !== expectedWarningOnly) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "warningOnly must be derived from parseFailed, warningCount, and criticalCount",
      path: ["warningOnly"],
    });
  }
});
export type VolumeAuditGateV1 = z.infer<typeof VolumeAuditGateSchema>;

export const VolumePipelineObservationSchema = z.object({
  actualChapterNumber: z.number().int().min(1),
  auditGate: VolumeAuditGateSchema,
  lengthGate: VolumeLengthGateSchema,
}).strict();
export type VolumePipelineObservationV1 = z.infer<typeof VolumePipelineObservationSchema>;

export const VolumeProductionRunSchema = z.object({
  runId: z.string().min(1),
  expectedChapterNumber: z.number().int().min(1),
  actualChapterNumber: z.number().int().min(1).optional(),
  observedNextChapterAfterRun: z.number().int().min(1).optional(),
  startedAt: IsoDateSchema,
  completedAt: IsoDateSchema.optional(),
  outcome: z.enum(["running", "awaiting_manual_review", "paused"]),
  pipelineStatus: VolumePipelineStatusSchema.optional(),
  auditGate: VolumeAuditGateSchema.optional(),
  lengthGate: VolumeLengthGateSchema.optional(),
  stopReason: VolumeProductionStopReasonSchema.optional(),
}).strict().superRefine((run, ctx) => {
  if (run.auditGate && run.pipelineStatus && run.auditGate.pipelineStatus !== run.pipelineStatus) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "pipelineStatus must match auditGate.pipelineStatus", path: ["pipelineStatus"] });
  }
  if (run.outcome === "running") {
    for (const key of ["actualChapterNumber", "observedNextChapterAfterRun", "completedAt", "pipelineStatus", "auditGate", "lengthGate", "stopReason"] as const) {
      if (run[key] !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "running run cannot contain terminal fields", path: [key] });
    }
  }
  if (run.outcome === "awaiting_manual_review") {
    for (const key of ["actualChapterNumber", "completedAt", "pipelineStatus", "auditGate", "lengthGate"] as const) {
      if (run[key] === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "awaiting_manual_review run requires terminal gates", path: [key] });
    }
  }
  if (run.outcome === "paused") {
    if (!run.completedAt) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "paused run requires completedAt", path: ["completedAt"] });
    if (!run.stopReason) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "paused run requires stopReason", path: ["stopReason"] });
  }
});
export type VolumeProductionRunV1 = z.infer<typeof VolumeProductionRunSchema>;
export const VolumeManualReviewSchema = z.object({
  runId: z.string().min(1),
  decision: VolumeManualReviewDecisionSchema,
  decidedAt: IsoDateSchema,
  note: z.string().optional(),
}).strict();
export type VolumeManualReviewV1 = z.infer<typeof VolumeManualReviewSchema>;

export const VolumeChapterProductionRecordSchema = z.object({
  chapterNumber: z.number().int().min(1),
  currentStatus: VolumeChapterProductionStatusSchema,
  runs: z.array(VolumeProductionRunSchema).min(1),
  reviews: z.array(VolumeManualReviewSchema),
  updatedAt: IsoDateSchema,
}).strict();
export type VolumeChapterProductionRecordV1 = z.infer<typeof VolumeChapterProductionRecordSchema>;

interface VolumeProductionStateShapeForValidation {
  readonly bookProductionStatus: VolumeBookProductionStatus;
  readonly activeRun?: {
    readonly runId: string;
    readonly expectedChapterNumber: number;
  };
  readonly chapters: Record<string, VolumeChapterProductionRecordV1>;
}
export const VolumeProductionStateSchema = z.object({
  schemaVersion: z.literal(VOLUME_PRODUCTION_STATE_SCHEMA_VERSION),
  bookId: SafeBookIdSchema,
  bookProductionStatus: VolumeBookProductionStatusSchema,
  activeRun: z.object({
    runId: z.string().min(1),
    expectedChapterNumber: z.number().int().min(1),
    startedAt: IsoDateSchema,
  }).strict().optional(),
  chapters: z.record(VolumeChapterProductionRecordSchema),
  updatedAt: IsoDateSchema,
}).strict().superRefine((state, ctx) => validateStateShape(state as VolumeProductionStateShapeForValidation, ctx));
export type VolumeProductionStateV1 = z.infer<typeof VolumeProductionStateSchema>;

export interface VolumePipelineMappingV1 {
  readonly runOutcome: "awaiting_manual_review" | "paused";
  readonly chapterStatus: "awaiting_manual_review" | "paused";
  readonly bookProductionStatus: VolumeBookProductionStatus;
  readonly stopReason?: VolumeProductionStopReason;
}

export interface VolumeProductionStateStoreOptions {
  readonly now?: () => Date;
  readonly atomicReplace?: (sourcePath: string, destinationPath: string) => Promise<void>;
}

export interface StartVolumeProductionRunInput {
  readonly bookId: string;
  readonly runId: string;
  readonly expectedChapterNumber: number;
  readonly startedAt?: string;
}

export interface CompleteVolumeProductionRunInput {
  readonly bookId: string;
  readonly runId: string;
  readonly observation: VolumePipelineObservationV1;
  readonly observedNextChapterAfterRun?: number;
  readonly completedAt?: string;
}

export interface PauseVolumeProductionRunInput {
  readonly bookId: string;
  readonly runId: string;
  readonly stopReason: VolumeProductionStopReason;
  readonly completedAt?: string;
}

export interface RecordVolumeManualReviewInput {
  readonly bookId: string;
  readonly chapterNumber: number;
  readonly runId: string;
  readonly decision: VolumeManualReviewDecision;
  readonly decidedAt?: string;
  readonly note?: string;
}

interface ResolvedVolumeStatePaths {
  readonly bookId: string;
  readonly statePath: string;
}

function validateStateShape(
  state: VolumeProductionStateShapeForValidation,
  ctx: z.RefinementCtx,
): void {
  const runningRuns: Array<{ readonly chapterNumber: number; readonly run: VolumeProductionRunV1 }> = [];

  for (const [key, chapter] of Object.entries(state.chapters)) {
    if (String(chapter.chapterNumber) !== key) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "chapter record key must equal chapterNumber", path: ["chapters", key, "chapterNumber"] });
    }

    const runIds = new Set<string>();
    for (const [index, run] of chapter.runs.entries()) {
      if (run.expectedChapterNumber !== chapter.chapterNumber) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "run.expectedChapterNumber must match chapterNumber", path: ["chapters", key, "runs", index, "expectedChapterNumber"] });
      }
      if (runIds.has(run.runId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "runId must be unique within a chapter record", path: ["chapters", key, "runs", index, "runId"] });
      }
      runIds.add(run.runId);
      if (run.outcome === "running") runningRuns.push({ chapterNumber: chapter.chapterNumber, run });
    }

    const latest = chapter.runs[chapter.runs.length - 1]!;
    if (chapter.currentStatus === "running" && latest.outcome !== "running") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "running chapter must have a running latest run", path: ["chapters", key, "currentStatus"] });
    }
    if (chapter.currentStatus !== "running" && latest.outcome === "running") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "non-running chapter cannot have a running latest run", path: ["chapters", key, "runs", chapter.runs.length - 1, "outcome"] });
    }
    if (chapter.currentStatus === "awaiting_manual_review" && latest.outcome !== "awaiting_manual_review") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "awaiting_manual_review chapter must match latest run outcome", path: ["chapters", key, "currentStatus"] });
    }
    if (chapter.currentStatus === "paused" && latest.outcome !== "paused") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "paused chapter must match latest run outcome", path: ["chapters", key, "currentStatus"] });
    }

    const reviewRunIds = new Set<string>();
    for (const [index, review] of chapter.reviews.entries()) {
      if (reviewRunIds.has(review.runId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "reviews may contain at most one decision per runId", path: ["chapters", key, "reviews", index, "runId"] });
      }
      reviewRunIds.add(review.runId);
      if (!runIds.has(review.runId)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "review.runId must reference a run in the same chapter", path: ["chapters", key, "reviews", index, "runId"] });
      }
    }

    const latestReview = chapter.reviews[chapter.reviews.length - 1];
    const expectedStatus = latestReview ? statusForDecision(latestReview.decision) : undefined;
    if ((chapter.currentStatus === "approved" || chapter.currentStatus === "rejected" || chapter.currentStatus === "revision_requested") && chapter.currentStatus !== expectedStatus) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "reviewed chapter status must match the latest manual review decision", path: ["chapters", key, "currentStatus"] });
    }
  }

  if (state.bookProductionStatus === "paused" && state.activeRun) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "paused book cannot have activeRun", path: ["activeRun"] });
  }
  if (state.activeRun) {
    const activeMatches = runningRuns.filter(({ run }) => run.runId === state.activeRun?.runId);
    if (activeMatches.length !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "activeRun must reference exactly one running run", path: ["activeRun", "runId"] });
    } else if (activeMatches[0]!.run.expectedChapterNumber !== state.activeRun.expectedChapterNumber) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "activeRun.expectedChapterNumber must match the running run", path: ["activeRun", "expectedChapterNumber"] });
    }
  } else if (runningRuns.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "running runs require activeRun", path: ["activeRun"] });
  }
  if (runningRuns.length > 1) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "state may contain at most one running run", path: ["activeRun"] });
  }
}
function statusForDecision(decision: VolumeManualReviewDecision): VolumeChapterProductionStatus {
  if (decision === "approve") return "approved";
  if (decision === "reject") return "rejected";
  return "revision_requested";
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatSchemaIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length > 0 ? issue.path.join(".") : "<root>") + ": " + issue.message)
    .join("; ");
}

function latestRun(record: VolumeChapterProductionRecordV1): VolumeProductionRunV1 {
  return record.runs[record.runs.length - 1]!;
}

function replaceLatestRun(record: VolumeChapterProductionRecordV1, run: VolumeProductionRunV1): VolumeProductionRunV1[] {
  return [...record.runs.slice(0, -1), run];
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function parseStateForBook(bookId: string, value: unknown): VolumeProductionStateV1 {
  const result = VolumeProductionStateSchema.safeParse(value);
  if (!result.success) {
    throw new VolumeProductionStateError(
      "PRODUCTION_STATE_INVALID_SCHEMA",
      bookId,
      "Invalid volume production state schema for book " + JSON.stringify(bookId) + ": " + formatSchemaIssues(result.error),
      { cause: result.error },
    );
  }
  if (result.data.bookId !== bookId) {
    throw new VolumeProductionStateError(
      "PRODUCTION_STATE_BOOK_ID_MISMATCH",
      bookId,
      "Volume production state bookId " + JSON.stringify(result.data.bookId) + " does not match expected bookId " + JSON.stringify(bookId),
    );
  }
  return result.data;
}

export function createDefaultVolumeProductionState(bookId: string, updatedAt = new Date().toISOString()): VolumeProductionStateV1 {
  return VolumeProductionStateSchema.parse({
    schemaVersion: VOLUME_PRODUCTION_STATE_SCHEMA_VERSION,
    bookId,
    bookProductionStatus: "active",
    chapters: {},
    updatedAt,
  });
}

export function summarizeChapterPipelineResult(result: ChapterPipelineResult, policy: VolumeProductionPolicyV1): VolumePipelineObservationV1 {
  const parseFailed = result.auditResult.parseFailed === true;
  const warningCount = result.auditResult.issues.filter((issue) => issue.severity === "warning").length;
  const criticalCount = result.auditResult.issues.filter((issue) => issue.severity === "critical").length;
  const warningOnly = !parseFailed && warningCount > 0 && criticalCount === 0;
  const softMin = policy.wordTolerance.softMin;
  const softMax = policy.wordTolerance.softMax;

  return VolumePipelineObservationSchema.parse({
    actualChapterNumber: result.chapterNumber,
    auditGate: {
      pipelineStatus: result.status,
      parseFailed,
      warningCount,
      criticalCount,
      warningOnly,
    },
    lengthGate: {
      target: policy.targetChapterWords,
      softMin,
      softMax,
      actual: result.wordCount,
      passed: result.wordCount >= softMin && result.wordCount <= softMax,
    },
  });
}

export function mapVolumePipelineObservation(observation: VolumePipelineObservationV1, expectedChapterNumber: number): VolumePipelineMappingV1 {
  if (observation.actualChapterNumber !== expectedChapterNumber) return pausedMapping("CHAPTER_NUMBER_MISMATCH");
  if (observation.auditGate.pipelineStatus === "state-degraded") return pausedMapping("STATE_DEGRADED");
  if (observation.auditGate.parseFailed) return pausedMapping("AUDIT_PARSE_FAILED");
  if (observation.auditGate.criticalCount > 0) return pausedMapping("AUDIT_CRITICAL");
  if (!observation.lengthGate.passed) return pausedMapping("LENGTH_OUT_OF_POLICY");
  if (observation.auditGate.pipelineStatus === "ready-for-review") return awaitingManualReviewMapping();
  if (observation.auditGate.warningOnly && observation.auditGate.warningCount > 0) {
    return awaitingManualReviewMapping("WARNING_OVERRIDE_REQUIRED");
  }
  return pausedMapping("AUDIT_FAILED");
}

export function mapVolumePipelineFailure(stopReason: VolumeProductionStopReason): VolumePipelineMappingV1 {
  return pausedMapping(stopReason);
}

function awaitingManualReviewMapping(stopReason?: VolumeProductionStopReason): VolumePipelineMappingV1 {
  return omitUndefined({
    runOutcome: "awaiting_manual_review",
    chapterStatus: "awaiting_manual_review",
    bookProductionStatus: "active",
    stopReason,
  }) as VolumePipelineMappingV1;
}

function pausedMapping(stopReason: VolumeProductionStopReason): VolumePipelineMappingV1 {
  return {
    runOutcome: "paused",
    chapterStatus: "paused",
    bookProductionStatus: "paused",
    stopReason,
  };
}

export function isReleaseEligible(state: VolumeProductionStateV1, chapterNumber: number): boolean {
  const record = state.chapters[String(chapterNumber)];
  if (!record || record.currentStatus !== "approved") return false;

  const run = latestRun(record);
  const review = record.reviews[record.reviews.length - 1];
  if (!review || review.runId !== run.runId || review.decision !== "approve") return false;
  if (run.outcome !== "awaiting_manual_review") return false;
  if (run.actualChapterNumber !== run.expectedChapterNumber) return false;
  if (!run.auditGate || !run.lengthGate) return false;
  if (run.auditGate.parseFailed) return false;
  if (run.auditGate.criticalCount > 0) return false;
  if (!run.lengthGate.passed) return false;
  if (run.auditGate.pipelineStatus === "state-degraded") return false;
  if (run.auditGate.pipelineStatus === "ready-for-review") return true;
  return run.auditGate.pipelineStatus === "audit-failed" && run.auditGate.warningOnly && run.auditGate.warningCount > 0;
}

export class VolumeProductionStateStore {
  private readonly now: () => Date;
  private readonly atomicReplace: (sourcePath: string, destinationPath: string) => Promise<void>;

  constructor(private readonly projectRoot: string, options: VolumeProductionStateStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.atomicReplace = options.atomicReplace ?? rename;
  }

  resolvePath(bookId: string): string {
    return this.resolvePaths(bookId).statePath;
  }

  async load(bookId: string): Promise<VolumeProductionStateV1> {
    const paths = this.resolvePaths(bookId);
    let raw: string;

    try {
      raw = await readFile(paths.statePath, "utf-8");
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return createDefaultVolumeProductionState(paths.bookId, this.now().toISOString());
      }
      throw new VolumeProductionStateError(
        "PRODUCTION_STATE_READ_FAILED",
        paths.bookId,
        "Failed to read " + VOLUME_PRODUCTION_STATE_RELATIVE_PATH + " for book " + JSON.stringify(paths.bookId),
        { cause: error },
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      throw new VolumeProductionStateError(
        "PRODUCTION_STATE_INVALID_JSON",
        paths.bookId,
        "Invalid JSON in " + VOLUME_PRODUCTION_STATE_RELATIVE_PATH + " for book " + JSON.stringify(paths.bookId),
        { cause: error },
      );
    }

    if (isRecord(parsedJson) && typeof parsedJson.schemaVersion === "number" && parsedJson.schemaVersion !== VOLUME_PRODUCTION_STATE_SCHEMA_VERSION) {
      throw new VolumeProductionStateError(
        "PRODUCTION_STATE_UNSUPPORTED_VERSION",
        paths.bookId,
        "Unsupported volume production state schemaVersion " + String(parsedJson.schemaVersion) + " for book " + JSON.stringify(paths.bookId),
      );
    }

    return parseStateForBook(paths.bookId, parsedJson);
  }

  async save(bookId: string, state: VolumeProductionStateV1): Promise<VolumeProductionStateV1> {
    const paths = this.resolvePaths(bookId);
    const parsed = parseStateForBook(paths.bookId, state);
    return this.withBookLock(paths.bookId, async () => {
      await this.load(paths.bookId);
      await this.writeAtomically(paths, parsed);
      return parsed;
    });
  }
  async startRun(input: StartVolumeProductionRunInput): Promise<VolumeProductionStateV1> {
    return this.updateState(input.bookId, (state, now) => {
      if (state.bookProductionStatus === "paused") {
        throw new VolumeProductionStateError("PRODUCTION_BOOK_PAUSED", input.bookId, "Cannot start volume production while book is paused", { chapterNumber: input.expectedChapterNumber, runId: input.runId });
      }
      if (state.activeRun) {
        throw new VolumeProductionStateError("PRODUCTION_ALREADY_RUNNING", input.bookId, "Volume production already has an active run", { chapterNumber: state.activeRun.expectedChapterNumber, runId: state.activeRun.runId });
      }
      const chapterKey = String(input.expectedChapterNumber);
      if (state.chapters[chapterKey]) {
        throw new VolumeProductionStateError("PRODUCTION_INVALID_TRANSITION", input.bookId, "Cannot start a run for a chapter that already has commercial state", { chapterNumber: input.expectedChapterNumber, runId: input.runId });
      }

      const startedAt = input.startedAt ?? now;
      const run: VolumeProductionRunV1 = { runId: input.runId, expectedChapterNumber: input.expectedChapterNumber, startedAt, outcome: "running" };
      const record: VolumeChapterProductionRecordV1 = {
        chapterNumber: input.expectedChapterNumber,
        currentStatus: "running",
        runs: [run],
        reviews: [],
        updatedAt: now,
      };

      return VolumeProductionStateSchema.parse({
        ...state,
        bookProductionStatus: "active",
        activeRun: { runId: input.runId, expectedChapterNumber: input.expectedChapterNumber, startedAt },
        chapters: { ...state.chapters, [chapterKey]: record },
        updatedAt: now,
      });
    });
  }

  async completeRun(input: CompleteVolumeProductionRunInput): Promise<VolumeProductionStateV1> {
    return this.updateState(input.bookId, (state, now) => {
      const activeRun = this.requireActiveRun(state, input.bookId, input.runId);
      const chapterKey = String(activeRun.expectedChapterNumber);
      const record = state.chapters[chapterKey];
      if (!record || record.currentStatus !== "running") {
        throw new VolumeProductionStateError("PRODUCTION_INVALID_TRANSITION", input.bookId, "Cannot complete a run unless the chapter is running", { chapterNumber: activeRun.expectedChapterNumber, runId: input.runId });
      }

      const currentRun = latestRun(record);
      if (currentRun.runId !== input.runId || currentRun.outcome !== "running") {
        throw new VolumeProductionStateError("PRODUCTION_INVALID_TRANSITION", input.bookId, "Stale runId cannot complete the active run", { chapterNumber: activeRun.expectedChapterNumber, runId: input.runId });
      }

      const observation = VolumePipelineObservationSchema.parse(input.observation);
      const mapping = mapVolumePipelineObservation(observation, activeRun.expectedChapterNumber);
      const completedRun = omitUndefined({
        ...currentRun,
        actualChapterNumber: observation.actualChapterNumber,
        observedNextChapterAfterRun: input.observedNextChapterAfterRun,
        completedAt: input.completedAt ?? now,
        outcome: mapping.runOutcome,
        pipelineStatus: observation.auditGate.pipelineStatus,
        auditGate: observation.auditGate,
        lengthGate: observation.lengthGate,
        stopReason: mapping.stopReason,
      }) as VolumeProductionRunV1;
      const updatedRecord: VolumeChapterProductionRecordV1 = {
        ...record,
        currentStatus: mapping.chapterStatus,
        runs: replaceLatestRun(record, completedRun),
        updatedAt: now,
      };

      return VolumeProductionStateSchema.parse({
        schemaVersion: VOLUME_PRODUCTION_STATE_SCHEMA_VERSION,
        bookId: state.bookId,
        bookProductionStatus: mapping.bookProductionStatus,
        chapters: { ...state.chapters, [chapterKey]: updatedRecord },
        updatedAt: now,
      });
    });
  }

  async pauseActiveRun(input: PauseVolumeProductionRunInput): Promise<VolumeProductionStateV1> {
    return this.updateState(input.bookId, (state, now) => {
      const activeRun = this.requireActiveRun(state, input.bookId, input.runId);
      const chapterKey = String(activeRun.expectedChapterNumber);
      const record = state.chapters[chapterKey];
      if (!record || record.currentStatus !== "running") {
        throw new VolumeProductionStateError("PRODUCTION_INVALID_TRANSITION", input.bookId, "Cannot pause a run unless the chapter is running", { chapterNumber: activeRun.expectedChapterNumber, runId: input.runId });
      }
      const currentRun = latestRun(record);
      if (currentRun.runId !== input.runId || currentRun.outcome !== "running") {
        throw new VolumeProductionStateError("PRODUCTION_INVALID_TRANSITION", input.bookId, "Stale runId cannot pause the active run", { chapterNumber: activeRun.expectedChapterNumber, runId: input.runId });
      }

      const completedRun: VolumeProductionRunV1 = {
        ...currentRun,
        completedAt: input.completedAt ?? now,
        outcome: "paused",
        stopReason: VolumeProductionStopReasonSchema.parse(input.stopReason),
      };
      const updatedRecord: VolumeChapterProductionRecordV1 = {
        ...record,
        currentStatus: "paused",
        runs: replaceLatestRun(record, completedRun),
        updatedAt: now,
      };

      return VolumeProductionStateSchema.parse({
        schemaVersion: VOLUME_PRODUCTION_STATE_SCHEMA_VERSION,
        bookId: state.bookId,
        bookProductionStatus: "paused",
        chapters: { ...state.chapters, [chapterKey]: updatedRecord },
        updatedAt: now,
      });
    });
  }

  async recordManualReview(input: RecordVolumeManualReviewInput): Promise<VolumeProductionStateV1> {
    return this.updateState(input.bookId, (state, now) => {
      const chapterKey = String(input.chapterNumber);
      const record = state.chapters[chapterKey];
      if (!record || record.currentStatus !== "awaiting_manual_review") {
        throw new VolumeProductionStateError("PRODUCTION_INVALID_TRANSITION", input.bookId, "Manual review requires a chapter awaiting manual review", { chapterNumber: input.chapterNumber, runId: input.runId });
      }
      const run = latestRun(record);
      if (run.runId !== input.runId || run.outcome !== "awaiting_manual_review") {
        throw new VolumeProductionStateError("PRODUCTION_INVALID_TRANSITION", input.bookId, "Stale runId cannot record a manual review", { chapterNumber: input.chapterNumber, runId: input.runId });
      }
      if (record.reviews.some((review: VolumeManualReviewV1) => review.runId === input.runId)) {
        throw new VolumeProductionStateError("PRODUCTION_INVALID_TRANSITION", input.bookId, "Manual review for this runId already exists", { chapterNumber: input.chapterNumber, runId: input.runId });
      }

      const review = omitUndefined({
        runId: input.runId,
        decision: input.decision,
        decidedAt: input.decidedAt ?? now,
        note: input.note,
      }) as VolumeManualReviewV1;
      const updatedRecord: VolumeChapterProductionRecordV1 = {
        ...record,
        currentStatus: statusForDecision(input.decision),
        reviews: [...record.reviews, review],
        updatedAt: now,
      };

      return VolumeProductionStateSchema.parse({
        ...state,
        chapters: { ...state.chapters, [chapterKey]: updatedRecord },
        updatedAt: now,
      });
    });
  }

  async releaseEligible(bookId: string, chapterNumber: number): Promise<boolean> {
    return isReleaseEligible(await this.load(bookId), chapterNumber);
  }
  private async updateState(
    bookId: string,
    update: (state: VolumeProductionStateV1, now: string) => VolumeProductionStateV1,
  ): Promise<VolumeProductionStateV1> {
    const paths = this.resolvePaths(bookId);
    return this.withBookLock(paths.bookId, async () => {
      const current = await this.load(paths.bookId);
      const next = parseStateForBook(paths.bookId, update(current, this.now().toISOString()));
      await this.writeAtomically(paths, next);
      return next;
    });
  }

  private async withBookLock<T>(bookId: string, action: () => Promise<T>): Promise<T> {
    let releaseLock: (() => Promise<void>) | undefined;
    try {
      releaseLock = await new StateManager(this.projectRoot).acquireBookLock(bookId);
    } catch (error) {
      if (error instanceof BookWriteLockError) throw error;
      throw new VolumeProductionStateError(
        "PRODUCTION_STATE_WRITE_FAILED",
        bookId,
        "Failed to acquire the write lock for book " + JSON.stringify(bookId),
        { cause: error },
      );
    }

    try {
      return await action();
    } catch (error) {
      if (error instanceof VolumeProductionStateError || error instanceof BookWriteLockError) throw error;
      throw new VolumeProductionStateError(
        "PRODUCTION_STATE_WRITE_FAILED",
        bookId,
        "Failed to update " + VOLUME_PRODUCTION_STATE_RELATIVE_PATH + " for book " + JSON.stringify(bookId),
        { cause: error },
      );
    } finally {
      await releaseLock();
    }
  }

  private requireActiveRun(
    state: VolumeProductionStateV1,
    bookId: string,
    runId: string,
  ): NonNullable<VolumeProductionStateV1["activeRun"]> {
    if (!state.activeRun) {
      throw new VolumeProductionStateError(
        "PRODUCTION_INVALID_TRANSITION",
        bookId,
        "No active volume production run exists",
        { runId },
      );
    }
    if (state.activeRun.runId !== runId) {
      throw new VolumeProductionStateError(
        "PRODUCTION_INVALID_TRANSITION",
        bookId,
        "Stale runId cannot update active volume production state",
        { chapterNumber: state.activeRun.expectedChapterNumber, runId },
      );
    }
    return state.activeRun;
  }

  private resolvePaths(bookId: string): ResolvedVolumeStatePaths {
    try {
      const safeBookId = assertSafeBookId(bookId, "volumeProduction.bookId");
      const booksRoot = safeChildPath(this.projectRoot, "books");
      const bookRoot = safeChildPath(booksRoot, safeBookId);
      return {
        bookId: safeBookId,
        statePath: safeChildPath(bookRoot, VOLUME_PRODUCTION_STATE_RELATIVE_PATH),
      };
    } catch (error) {
      throw new VolumeProductionStateError(
        "PRODUCTION_STATE_INVALID_PATH",
        typeof bookId === "string" ? bookId : String(bookId),
        "Invalid volume production state path for bookId " + JSON.stringify(bookId),
        { cause: error },
      );
    }
  }

  private async writeAtomically(paths: ResolvedVolumeStatePaths, state: VolumeProductionStateV1): Promise<void> {
    const directory = dirname(paths.statePath);
    const temporaryPath = safeChildPath(
      directory,
      ".volume-production-state." + process.pid + "." + randomUUID() + ".tmp",
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    try {
      await mkdir(directory, { recursive: true });
      handle = await open(temporaryPath, "wx");
      await handle.writeFile(JSON.stringify(state, null, 2) + "\n", "utf-8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.atomicReplace(temporaryPath, paths.statePath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new VolumeProductionStateError(
        "PRODUCTION_STATE_WRITE_FAILED",
        paths.bookId,
        "Failed to atomically write " + VOLUME_PRODUCTION_STATE_RELATIVE_PATH + " for book " + JSON.stringify(paths.bookId),
        { cause: error },
      );
    }
  }
}
