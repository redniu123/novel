import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BookStrategyStore } from "../commercial/book-strategy.js";
import {
  VOLUME_PRODUCTION_RUN_TIMEOUT_MS,
  VolumeProductionPolicyError,
  VolumeProductionPolicyResolver,
  type VolumeProductionPolicyV1,
} from "../commercial/volume-production-policy.js";
import {
  VolumePipelineObservationSchema,
  VolumeProductionStateError,
  VolumeProductionStateSchema,
  VolumeProductionStateStore,
  isReleaseEligible,
  mapVolumePipelineFailure,
  mapVolumePipelineObservation,
  summarizeChapterPipelineResult,
  type VolumeAuditGateV1,
  type VolumeLengthGateV1,
  type VolumeManualReviewDecision,
  type VolumePipelineObservationV1,
  type VolumePipelineStatus,
  type VolumeProductionStateErrorCode,
  type VolumeProductionStateV1,
} from "../commercial/volume-production-state.js";
import type { ChapterPipelineResult } from "../pipeline/runner.js";

const ENV_KEYS = [
  "INKOS_LLM_SERVICE",
  "INKOS_LLM_PROVIDER",
  "INKOS_LLM_BASE_URL",
  "INKOS_LLM_MODEL",
  "INKOS_LLM_API_KEY",
] as const;

const ISO_1 = "2026-07-16T00:00:00.000Z";
const ISO_2 = "2026-07-16T00:01:00.000Z";
const ISO_3 = "2026-07-16T00:02:00.000Z";

let projectRoot = "";
let previousEnv = new Map<string, string | undefined>();

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "inkos-volume-policy-state-"));
  previousEnv = new Map();
  for (const key of ENV_KEYS) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = "";
  }
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    const previous = previousEnv.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  previousEnv.clear();
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  projectRoot = "";
});

async function writeProjectConfig(writing?: { readonly reviewRetries?: number }): Promise<void> {
  await writeFile(join(projectRoot, ".env"), "", "utf-8");
  await writeFile(join(projectRoot, "inkos.json"), JSON.stringify({
    name: "volume-test",
    version: "0.1.0",
    language: "zh",
    llm: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test",
      apiKey: "",
    },
    notify: [],
    ...(writing ? { writing } : {}),
  }, null, 2), "utf-8");
}

async function writeBookConfig(bookId: string, chapterWordCount = 3000): Promise<void> {
  const bookPath = join(projectRoot, "books", bookId, "book.json");
  await mkdir(dirname(bookPath), { recursive: true });
  await writeFile(bookPath, JSON.stringify({
    id: bookId,
    title: bookId,
    platform: "tomato",
    genre: "urban",
    status: "active",
    targetChapters: 200,
    chapterWordCount,
    createdAt: ISO_1,
    updatedAt: ISO_1,
  }, null, 2), "utf-8");
}

async function writeStateFile(bookId: string, value: unknown): Promise<void> {
  const path = statePath(bookId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, typeof value === "string" ? value : JSON.stringify(value, null, 2), "utf-8");
}

function statePath(bookId: string): string {
  return join(projectRoot, "books", bookId, "commercial", "volume-production-state.json");
}

async function expectStateError(promise: Promise<unknown>, code: VolumeProductionStateErrorCode): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: "VolumeProductionStateError", code });
}

function policyFixture(overrides: Partial<VolumeProductionPolicyV1> = {}): VolumeProductionPolicyV1 {
  return {
    schemaVersion: 1,
    mode: "volume",
    chaptersPerRun: 1,
    auditRequired: true,
    targetChapterWords: 3000,
    maxAutoRevisions: 1,
    wordTolerance: { source: "length_spec_soft_range", softMin: 2591, softMax: 3409 },
    manualApprovalRequired: true,
    allowApprovalWithWarnings: true,
    maxPipelineRetries: 0,
    runTimeoutMs: VOLUME_PRODUCTION_RUN_TIMEOUT_MS,
    failureAction: "pause_book",
    ...overrides,
  };
}

function pipelineResult(options: {
  readonly chapterNumber?: number;
  readonly status?: ChapterPipelineResult["status"];
  readonly wordCount?: number;
  readonly parseFailed?: boolean;
  readonly severities?: ReadonlyArray<"critical" | "warning" | "info">;
  readonly tokenUsage?: ChapterPipelineResult["tokenUsage"];
} = {}): ChapterPipelineResult {
  return {
    chapterNumber: options.chapterNumber ?? 1,
    title: "Chapter",
    wordCount: options.wordCount ?? 3000,
    status: options.status ?? "ready-for-review",
    revised: false,
    auditResult: {
      passed: true,
      parseFailed: options.parseFailed,
      summary: "ok",
      issues: (options.severities ?? []).map((severity, index) => ({
        severity,
        category: "c" + index,
        description: "d" + index,
        suggestion: "s" + index,
      })),
      tokenUsage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    },
    tokenUsage: options.tokenUsage,
  };
}function observation(options: {
  readonly actualChapterNumber?: number;
  readonly pipelineStatus?: VolumePipelineStatus;
  readonly parseFailed?: boolean;
  readonly warningCount?: number;
  readonly criticalCount?: number;
  readonly warningOnly?: boolean;
  readonly actualWords?: number;
  readonly lengthPassed?: boolean;
} = {}): VolumePipelineObservationV1 {
  const parseFailed = options.parseFailed ?? false;
  const warningCount = options.warningCount ?? 0;
  const criticalCount = options.criticalCount ?? 0;
  return VolumePipelineObservationSchema.parse({
    actualChapterNumber: options.actualChapterNumber ?? 1,
    auditGate: {
      pipelineStatus: options.pipelineStatus ?? "ready-for-review",
      parseFailed,
      warningCount,
      criticalCount,
      warningOnly: options.warningOnly ?? (!parseFailed && warningCount > 0 && criticalCount === 0),
    },
    lengthGate: {
      target: 3000,
      softMin: 2591,
      softMax: 3409,
      actual: options.actualWords ?? 3000,
      passed: options.lengthPassed ?? ((options.actualWords ?? 3000) >= 2591 && (options.actualWords ?? 3000) <= 3409),
    },
  });
}

function eligibleState(options: {
  readonly status?: "awaiting_manual_review" | "approved" | "rejected" | "revision_requested" | "paused";
  readonly decision?: VolumeManualReviewDecision;
  readonly auditGate?: Partial<VolumeAuditGateV1>;
  readonly lengthGate?: Partial<VolumeLengthGateV1>;
  readonly actualChapterNumber?: number;
  readonly outcome?: "awaiting_manual_review" | "paused";
  readonly includeReview?: boolean;
} = {}): VolumeProductionStateV1 {
  const auditGate = {
    pipelineStatus: "ready-for-review" as const,
    parseFailed: false,
    warningCount: 0,
    criticalCount: 0,
    warningOnly: false,
    ...options.auditGate,
  };
  const lengthGate = {
    target: 3000,
    softMin: 2591,
    softMax: 3409,
    actual: 3000,
    passed: true,
    ...options.lengthGate,
  };
  const includeReview = options.includeReview ?? true;
  const decision = options.decision ?? "approve";
  return VolumeProductionStateSchema.parse({
    schemaVersion: 1,
    bookId: "book-a",
    bookProductionStatus: "active",
    chapters: {
      "1": {
        chapterNumber: 1,
        currentStatus: options.status ?? "approved",
        runs: [{
          runId: "run-1",
          expectedChapterNumber: 1,
          actualChapterNumber: options.actualChapterNumber ?? 1,
          startedAt: ISO_1,
          completedAt: ISO_2,
          outcome: options.outcome ?? "awaiting_manual_review",
          pipelineStatus: auditGate.pipelineStatus,
          auditGate,
          lengthGate,
          ...(options.outcome === "paused" ? { stopReason: "AUDIT_FAILED" } : {}),
        }],
        reviews: includeReview ? [{ runId: "run-1", decision, decidedAt: ISO_3 }] : [],
        updatedAt: ISO_3,
      },
    },
    updatedAt: ISO_3,
  });
}

describe("VolumeProductionPolicyResolver", () => {
  it("resolves default volume policy without a strategy file or API credentials", async () => {
    await writeProjectConfig();
    await writeBookConfig("default-volume", 3000);

    const policy = await new VolumeProductionPolicyResolver({ projectRoot }).resolve("default-volume");

    expect(policy).toMatchObject({
      schemaVersion: 1,
      mode: "volume",
      chaptersPerRun: 1,
      auditRequired: true,
      targetChapterWords: 3000,
      maxAutoRevisions: 1,
      wordTolerance: { source: "length_spec_soft_range", softMin: 2591, softMax: 3409 },
      manualApprovalRequired: true,
      allowApprovalWithWarnings: true,
      maxPipelineRetries: 0,
      runTimeoutMs: 3_600_000,
      failureAction: "pause_book",
    });
    await expect(access(join(projectRoot, "books", "default-volume", "commercial", "book-strategy.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("resolves explicit volume and writing.reviewRetries", async () => {
    await writeProjectConfig({ reviewRetries: 4 });
    await writeBookConfig("explicit-volume", 3200);
    await new BookStrategyStore(projectRoot).setProductionMode("explicit-volume", "volume");

    const policy = await new VolumeProductionPolicyResolver({ projectRoot }).resolve("explicit-volume");

    expect(policy.targetChapterWords).toBe(3200);
    expect(policy.maxAutoRevisions).toBe(4);
    expect(policy.wordTolerance.softMin).toBe(2764);
    expect(policy.wordTolerance.softMax).toBe(3636);
  });

  it("returns a stable not implemented error for flagship", async () => {
    await writeProjectConfig();
    await writeBookConfig("flagship-book");
    await new BookStrategyStore(projectRoot).setProductionMode("flagship-book", "flagship");

    await expect(new VolumeProductionPolicyResolver({ projectRoot }).resolve("flagship-book")).rejects.toMatchObject({
      name: "VolumeProductionPolicyError",
      code: "PRODUCTION_POLICY_NOT_IMPLEMENTED",
      bookId: "flagship-book",
    });
  });

  it("allows dependency injection while preserving the real loader chain shape", async () => {
    const calls: string[] = [];
    const resolver = new VolumeProductionPolicyResolver({
      projectRoot,
      bookStrategyStore: { load: async (bookId) => { calls.push("strategy:" + bookId); return { schemaVersion: 1, bookId, productionMode: "volume", source: "default" }; } },
      stateManager: { loadBookConfig: async (bookId) => { calls.push("book:" + bookId); return { id: bookId, title: "t", platform: "tomato", genre: "g", status: "active", targetChapters: 1, chapterWordCount: 2500, createdAt: ISO_1, updatedAt: ISO_1 }; } },
      loadProjectConfig: async (root, options) => {
        calls.push("project:" + root + ":" + String(options?.requireApiKey));
        return { name: "p", version: "0.1.0", language: "zh", llm: { provider: "openai", service: "custom", configSource: "env", baseUrl: "https://api.openai.com/v1", apiKey: "", model: "m", temperature: 0.7, thinkingBudget: 0, apiFormat: "chat", stream: true }, notify: [], foundation: { reviewRetries: 2 }, writing: { reviewRetries: 2, reviewMode: "auto", revisionGate: "strict" }, researchSearch: { enabled: false, provider: "tavily" }, inputGovernanceMode: "v2", daemon: { schedule: { radarCron: "0 */6 * * *", writeCron: "*/15 * * * *" }, maxConcurrentBooks: 3, chaptersPerCycle: 1, retryDelayMs: 30000, cooldownAfterChapterMs: 10000, maxChaptersPerDay: 50, qualityGates: { maxAuditRetries: 2, pauseAfterConsecutiveFailures: 3, retryTemperatureStep: 0.1 } } };
      },
      buildLengthSpec: (target) => { calls.push("length:" + target); return { target, softMin: 2400, softMax: 2600, hardMin: 2300, hardMax: 2700, countingMode: "zh_chars", normalizeMode: "none" }; },
    });

    await expect(resolver.resolve("injected-book")).resolves.toMatchObject({
      targetChapterWords: 2500,
      maxAutoRevisions: 2,
      wordTolerance: { softMin: 2400, softMax: 2600 },
    });
    expect(calls).toEqual(["strategy:injected-book", "book:injected-book", "project:" + projectRoot + ":false", "length:2500"]);
  });
});
describe("VolumeProductionStateStore", () => {
  function store(now = ISO_1): VolumeProductionStateStore {
    return new VolumeProductionStateStore(projectRoot, { now: () => new Date(now) });
  }

  it("returns an in-memory default when the state file does not exist", async () => {
    const result = await store().load("missing-state");

    expect(result).toMatchObject({
      schemaVersion: 1,
      bookId: "missing-state",
      bookProductionStatus: "active",
      chapters: {},
    });
    await expect(access(statePath("missing-state"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes and reads a legal v1 state through protected transitions", async () => {
    const written = await store().startRun({ bookId: "legal-book", runId: "run-1", expectedChapterNumber: 1, startedAt: ISO_1 });

    await expect(store().load("legal-book")).resolves.toEqual(written);
  });

  it("rejects damaged JSON and does not silently overwrite it", async () => {
    await writeStateFile("damaged-state", "{ damaged");
    await expectStateError(store().load("damaged-state"), "PRODUCTION_STATE_INVALID_JSON");
    await expectStateError(store().startRun({ bookId: "damaged-state", runId: "run-1", expectedChapterNumber: 1, startedAt: ISO_1 }), "PRODUCTION_STATE_INVALID_JSON");
    await expect(readFile(statePath("damaged-state"), "utf-8")).resolves.toBe("{ damaged");
  });

  it("rejects schema-invalid states and unknown fields", async () => {
    await writeStateFile("unknown-field", {
      schemaVersion: 1,
      bookId: "unknown-field",
      bookProductionStatus: "active",
      chapters: {},
      updatedAt: ISO_1,
      tokenUsage: { totalTokens: 1 },
    });

    await expectStateError(store().load("unknown-field"), "PRODUCTION_STATE_INVALID_SCHEMA");
  });

  it("rejects unsupported schemaVersion distinctly", async () => {
    await writeStateFile("future-state", {
      schemaVersion: 2,
      bookId: "future-state",
      bookProductionStatus: "active",
      chapters: {},
      updatedAt: ISO_1,
    });

    await expectStateError(store().load("future-state"), "PRODUCTION_STATE_UNSUPPORTED_VERSION");
  });

  it("rejects bookId mismatches and path traversal", async () => {
    await writeStateFile("book-a", {
      schemaVersion: 1,
      bookId: "book-b",
      bookProductionStatus: "active",
      chapters: {},
      updatedAt: ISO_1,
    });

    await expectStateError(store().load("book-a"), "PRODUCTION_STATE_BOOK_ID_MISMATCH");
    expect(() => store().resolvePath("../outside")).toThrowError(VolumeProductionStateError);
    await expectStateError(store().load("../outside"), "PRODUCTION_STATE_INVALID_PATH");
  });

  it("keeps two books isolated", async () => {
    await store().startRun({ bookId: "book-one", runId: "run-1", expectedChapterNumber: 1, startedAt: ISO_1 });
    await store().startRun({ bookId: "book-two", runId: "run-2", expectedChapterNumber: 2, startedAt: ISO_1 });

    expect(await store().load("book-one")).toMatchObject({ activeRun: { runId: "run-1", expectedChapterNumber: 1 } });
    expect(await store().load("book-two")).toMatchObject({ activeRun: { runId: "run-2", expectedChapterNumber: 2 } });
    expect(statePath("book-one")).not.toBe(statePath("book-two"));
  });

  it("preserves the old state when atomic replace fails", async () => {
    const baseStore = store();
    await baseStore.startRun({ bookId: "atomic-state", runId: "run-1", expectedChapterNumber: 1, startedAt: ISO_1 });
    const before = await readFile(statePath("atomic-state"), "utf-8");
    const failingStore = new VolumeProductionStateStore(projectRoot, {
      now: () => new Date(ISO_2),
      atomicReplace: async () => { throw Object.assign(new Error("rename failed"), { code: "EACCES" }); },
    });

    await expectStateError(failingStore.pauseActiveRun({ bookId: "atomic-state", runId: "run-1", stopReason: "PRODUCTION_PIPELINE_FAILED", completedAt: ISO_2 }), "PRODUCTION_STATE_WRITE_FAILED");

    expect(await readFile(statePath("atomic-state"), "utf-8")).toBe(before);
    expect(await baseStore.load("atomic-state")).toMatchObject({ activeRun: { runId: "run-1" }, bookProductionStatus: "active" });
  });

  it("rejects illegal transitions, activeRun conflicts, and stale runIds", async () => {
    const stateStore = store();
    await expectStateError(stateStore.completeRun({ bookId: "illegal", runId: "missing", observation: observation(), completedAt: ISO_2 }), "PRODUCTION_INVALID_TRANSITION");
    await stateStore.startRun({ bookId: "conflict", runId: "run-1", expectedChapterNumber: 1, startedAt: ISO_1 });
    await expectStateError(stateStore.startRun({ bookId: "conflict", runId: "run-2", expectedChapterNumber: 2, startedAt: ISO_1 }), "PRODUCTION_ALREADY_RUNNING");
    await expectStateError(stateStore.completeRun({ bookId: "conflict", runId: "stale", observation: observation(), completedAt: ISO_2 }), "PRODUCTION_INVALID_TRANSITION");
    await expectStateError(stateStore.pauseActiveRun({ bookId: "conflict", runId: "stale", stopReason: "PRODUCTION_ABORTED", completedAt: ISO_2 }), "PRODUCTION_INVALID_TRANSITION");
  });

  it("records runs and manual reviews as append-only history structures", async () => {
    const historical = eligibleState();
    historical.chapters["1"]!.runs.push({
      runId: "run-2",
      expectedChapterNumber: 1,
      actualChapterNumber: 1,
      startedAt: ISO_1,
      completedAt: ISO_2,
      outcome: "awaiting_manual_review",
      pipelineStatus: "audit-failed",
      auditGate: { pipelineStatus: "audit-failed", parseFailed: false, warningCount: 1, criticalCount: 0, warningOnly: true },
      lengthGate: { target: 3000, softMin: 2591, softMax: 3409, actual: 3000, passed: true },
      stopReason: "WARNING_OVERRIDE_REQUIRED",
    });
    historical.chapters["1"]!.reviews.push({ runId: "run-2", decision: "approve", decidedAt: ISO_3 });
    await writeStateFile("book-a", historical);

    const loaded = await store().load("book-a");
    expect(loaded.chapters["1"]?.runs.map((run) => run.runId)).toEqual(["run-1", "run-2"]);
    expect(loaded.chapters["1"]?.reviews.map((review) => review.runId)).toEqual(["run-1", "run-2"]);
  });
});
describe("pipeline observation and mapping", () => {
  it("summarizes ChapterPipelineResult from public direct fields and excludes tokenUsage", () => {
    const result = pipelineResult({
      chapterNumber: 7,
      status: "audit-failed",
      wordCount: 3001,
      severities: ["warning", "info"],
      tokenUsage: { promptTokens: 10, completionTokens: 20, totalTokens: 30 },
    });

    const summary = summarizeChapterPipelineResult(result, policyFixture());

    expect(summary).toEqual({
      actualChapterNumber: 7,
      auditGate: {
        pipelineStatus: "audit-failed",
        parseFailed: false,
        warningCount: 1,
        criticalCount: 0,
        warningOnly: true,
      },
      lengthGate: {
        target: 3000,
        softMin: 2591,
        softMax: 3409,
        actual: 3001,
        passed: true,
      },
    });
    expect(JSON.stringify(summary)).not.toContain("tokenUsage");
  });

  it("derives warning, critical, warningOnly, and optional parseFailed correctly", () => {
    expect(summarizeChapterPipelineResult(pipelineResult({ severities: ["info", "warning"] }), policyFixture()).auditGate).toMatchObject({
      parseFailed: false,
      warningCount: 1,
      criticalCount: 0,
      warningOnly: true,
    });
    expect(summarizeChapterPipelineResult(pipelineResult({ severities: ["warning", "critical"] }), policyFixture()).auditGate).toMatchObject({
      warningCount: 1,
      criticalCount: 1,
      warningOnly: false,
    });
    expect(summarizeChapterPipelineResult(pipelineResult({ parseFailed: true, severities: ["warning"] }), policyFixture()).auditGate).toMatchObject({
      parseFailed: true,
      warningOnly: false,
    });
  });

  it("maps every pipeline result branch deterministically", () => {
    expect(mapVolumePipelineObservation(observation({ actualChapterNumber: 2 }), 1)).toMatchObject({ chapterStatus: "paused", stopReason: "CHAPTER_NUMBER_MISMATCH" });
    expect(mapVolumePipelineObservation(observation({ pipelineStatus: "state-degraded" }), 1)).toMatchObject({ chapterStatus: "paused", stopReason: "STATE_DEGRADED" });
    expect(mapVolumePipelineObservation(observation({ parseFailed: true }), 1)).toMatchObject({ chapterStatus: "paused", stopReason: "AUDIT_PARSE_FAILED" });
    expect(mapVolumePipelineObservation(observation({ criticalCount: 1 }), 1)).toMatchObject({ chapterStatus: "paused", stopReason: "AUDIT_CRITICAL" });
    expect(mapVolumePipelineObservation(observation({ actualWords: 2000, lengthPassed: false }), 1)).toMatchObject({ chapterStatus: "paused", stopReason: "LENGTH_OUT_OF_POLICY" });
    expect(mapVolumePipelineObservation(observation({ pipelineStatus: "ready-for-review" }), 1)).toEqual({ runOutcome: "awaiting_manual_review", chapterStatus: "awaiting_manual_review", bookProductionStatus: "active" });
    expect(mapVolumePipelineObservation(observation({ pipelineStatus: "audit-failed", warningCount: 1 }), 1)).toMatchObject({ chapterStatus: "awaiting_manual_review", stopReason: "WARNING_OVERRIDE_REQUIRED" });
    expect(mapVolumePipelineObservation(observation({ pipelineStatus: "audit-failed" }), 1)).toMatchObject({ chapterStatus: "paused", stopReason: "AUDIT_FAILED" });
    expect(mapVolumePipelineFailure("PRODUCTION_TIMEOUT")).toMatchObject({ chapterStatus: "paused", bookProductionStatus: "paused", stopReason: "PRODUCTION_TIMEOUT" });
    expect(mapVolumePipelineFailure("PRODUCTION_ABORTED")).toMatchObject({ stopReason: "PRODUCTION_ABORTED" });
    expect(mapVolumePipelineFailure("PRODUCTION_PIPELINE_FAILED")).toMatchObject({ stopReason: "PRODUCTION_PIPELINE_FAILED" });
  });

  it("does not persist tokenUsage, chapter prose, prompts, or story facts", async () => {
    const stateStore = new VolumeProductionStateStore(projectRoot, { now: () => new Date(ISO_1) });
    await stateStore.startRun({ bookId: "boundary-book", runId: "run-1", expectedChapterNumber: 1, startedAt: ISO_1 });
    await stateStore.completeRun({
      bookId: "boundary-book",
      runId: "run-1",
      observation: summarizeChapterPipelineResult(pipelineResult({ tokenUsage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } }), policyFixture()),
      completedAt: ISO_2,
    });
    const raw = await readFile(statePath("boundary-book"), "utf-8");

    expect(raw).not.toContain("tokenUsage");
    expect(raw).not.toContain("正文");
    expect(raw).not.toContain("prompt");
    expect(raw).not.toContain("story/state");
    expect(raw).not.toContain("ChapterMeta");
  });
});

describe("release eligibility", () => {
  it("returns true only for approved chapters that pass every commercial gate", () => {
    expect(isReleaseEligible(eligibleState(), 1)).toBe(true);
  });

  it("allows manually approved warning-only audit-failed chapters", () => {
    expect(isReleaseEligible(eligibleState({ auditGate: { pipelineStatus: "audit-failed", warningCount: 1, warningOnly: true } }), 1)).toBe(true);
  });

  it("returns false for missing approval, reject, request_revision, and missing chapter", () => {
    expect(isReleaseEligible(eligibleState({ status: "awaiting_manual_review", includeReview: false }), 1)).toBe(false);
    expect(isReleaseEligible(eligibleState({ status: "rejected", decision: "reject" }), 1)).toBe(false);
    expect(isReleaseEligible(eligibleState({ status: "revision_requested", decision: "request_revision" }), 1)).toBe(false);
    expect(isReleaseEligible(eligibleState(), 2)).toBe(false);
  });

  it("returns false for hard gate failures", () => {
    const cases: Array<[string, VolumeProductionStateV1]> = [
      ["critical", eligibleState({ auditGate: { criticalCount: 1 } })],
      ["parse", eligibleState({ auditGate: { parseFailed: true } })],
      ["length", eligibleState({ lengthGate: { actual: 2000, passed: false } })],
      ["state", eligibleState({ auditGate: { pipelineStatus: "state-degraded" } })],
      ["mismatch", eligibleState({ actualChapterNumber: 2 })],
      ["paused", eligibleState({ status: "paused", outcome: "paused", decision: "approve" })],
    ];

    for (const [, state] of cases) {
      expect(isReleaseEligible(state, 1)).toBe(false);
    }
  });

  it("uses the Store API without reading ChapterMeta.status", async () => {
    const stateStore = new VolumeProductionStateStore(projectRoot);
    await writeStateFile("book-a", eligibleState());

    await expect(stateStore.releaseEligible("book-a", 1)).resolves.toBe(true);
  });
});
