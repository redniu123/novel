import { access, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BookStrategyStore } from "../commercial/book-strategy.js";
import {
  VolumeProductionOrchestrator,
  buildVolumePipelineConfig,
  type VolumePipelineRunnerLike,
  type VolumeProductionSettledEvent,
  type VolumeProductionOrchestratorOptions,
} from "../commercial/volume-production-orchestrator.js";
import { VolumeProductionReviewService } from "../commercial/volume-production-review.js";
import {
  VOLUME_PRODUCTION_RUN_TIMEOUT_MS,
  type VolumeProductionPolicyV1,
} from "../commercial/volume-production-policy.js";
import {
  VolumeProductionStateStore,
  type VolumeProductionStateV1,
} from "../commercial/volume-production-state.js";
import type { ChapterPipelineResult, PipelineConfig } from "../pipeline/runner.js";
import { StateManager } from "../state/manager.js";

const ENV_KEYS = [
  "INKOS_LLM_SERVICE",
  "INKOS_LLM_PROVIDER",
  "INKOS_LLM_BASE_URL",
  "INKOS_LLM_MODEL",
  "INKOS_LLM_API_KEY",
] as const;

const ISO_1 = "2026-07-17T00:00:00.000Z";

let projectRoot = "";
let previousEnv = new Map<string, string | undefined>();

beforeEach(async () => {
  projectRoot = await mkdtemp(join(tmpdir(), "inkos-volume-orchestrator-"));
  previousEnv = new Map();
  for (const key of ENV_KEYS) {
    previousEnv.set(key, process.env[key]);
    process.env[key] = "";
  }
});

afterEach(async () => {
  vi.useRealTimers();
  for (const key of ENV_KEYS) {
    const previous = previousEnv.get(key);
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  previousEnv.clear();
  if (projectRoot) await rm(projectRoot, { recursive: true, force: true });
  projectRoot = "";
});

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
}

function seqNextChapter(values: ReadonlyArray<number>): Pick<StateManager, "getNextChapterNumber"> {
  let index = 0;
  return { getNextChapterNumber: vi.fn(async () => values[Math.min(index++, values.length - 1)]!) };
}

function fakeRunner(write: (bookId: string) => Promise<ChapterPipelineResult>): VolumePipelineRunnerLike & {
  readonly writeNextChapter: ReturnType<typeof vi.fn>;
} {
  const writeNextChapter = vi.fn((bookId: string) => write(bookId));
  return {
    writeNextChapter,
    runWithAbortSignal<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T> {
      // Mirrors PipelineRunner.runWithAbortSignal: throw before the task when
      // already aborted, reject when the signal fires mid-flight.
      if (signal?.aborted) return Promise.reject(new Error("aborted before start"));
      return new Promise<T>((resolvePromise, rejectPromise) => {
        const onAbort = () => rejectPromise(new Error("operation aborted"));
        signal?.addEventListener("abort", onAbort, { once: true });
        task().then(
          (value) => {
            signal?.removeEventListener("abort", onAbort);
            resolvePromise(value);
          },
          (error) => {
            signal?.removeEventListener("abort", onAbort);
            rejectPromise(error);
          },
        );
      });
    },
  };
}

function realStore(): VolumeProductionStateStore {
  return new VolumeProductionStateStore(projectRoot, { now: () => new Date(ISO_1) });
}

function statePath(bookId: string): string {
  return join(projectRoot, "books", bookId, "commercial", "volume-production-state.json");
}

function makeOrchestrator(overrides: Partial<VolumeProductionOrchestratorOptions> = {}): VolumeProductionOrchestrator {
  return new VolumeProductionOrchestrator({
    projectRoot,
    policyResolver: { resolve: async () => policyFixture() },
    stateStore: realStore(),
    stateManager: seqNextChapter([1, 1, 2]),
    runnerFactory: () => fakeRunner(async () => pipelineResult()),
    runIdFactory: () => "run-1",
    ...overrides,
  });
}

async function writeProjectConfig(): Promise<void> {
  await writeFile(join(projectRoot, ".env"), "", "utf-8");
  await writeFile(join(projectRoot, "inkos.json"), JSON.stringify({
    name: "volume-orchestrator-test",
    version: "0.1.0",
    language: "zh",
    llm: {
      provider: "openai",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test",
      apiKey: "",
    },
    notify: [],
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

describe("policy dispatch (FR-B01)", () => {
  it("enters the orchestrator for default and explicit volume via the real resolver", async () => {
    await writeProjectConfig();
    await writeBookConfig("default-book");
    await writeBookConfig("explicit-book");
    await new BookStrategyStore(projectRoot).setProductionMode("explicit-book", "volume");

    for (const bookId of ["default-book", "explicit-book"]) {
      const runner = fakeRunner(async () => pipelineResult());
      const result = await makeOrchestrator({
        policyResolver: undefined,
        stateManager: seqNextChapter([1, 1, 2]),
        runnerFactory: () => runner,
        runIdFactory: () => "run-" + bookId,
      }).produceNextChapter({ bookId });

      expect(result.productionStatus).toBe("awaiting_manual_review");
      expect(runner.writeNextChapter).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects flagship before any run or Runner call", async () => {
    await writeProjectConfig();
    await writeBookConfig("flagship-book");
    await new BookStrategyStore(projectRoot).setProductionMode("flagship-book", "flagship");
    const runnerFactory = vi.fn(() => fakeRunner(async () => pipelineResult()));

    await expect(
      makeOrchestrator({ policyResolver: undefined, runnerFactory }).produceNextChapter({ bookId: "flagship-book" }),
    ).rejects.toMatchObject({ name: "VolumeProductionPolicyError", code: "PRODUCTION_POLICY_NOT_IMPLEMENTED" });

    expect(runnerFactory).not.toHaveBeenCalled();
    await expect(access(statePath("flagship-book"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("runner factory configuration (FR-B04)", () => {
  it("forces auto review mode and the policy revision limit onto the base config", () => {
    const base = {
      client: { chat: async () => ({ content: "" }) },
      model: "base-model",
      projectRoot: "/somewhere/else",
      chapterReviewMode: "manual",
      writingReviewRetries: 9,
      inputGovernanceMode: "legacy",
    } as unknown as PipelineConfig;

    const merged = buildVolumePipelineConfig(base, policyFixture({ maxAutoRevisions: 3 }), "/project/root");

    expect(merged.chapterReviewMode).toBe("auto");
    expect(merged.writingReviewRetries).toBe(3);
    expect(merged.projectRoot).toBe("/project/root");
    expect(merged.model).toBe("base-model");
    expect(merged.inputGovernanceMode).toBe("legacy");
  });

  it("passes the resolved policy to an injected runner factory", async () => {
    const policy = policyFixture({ maxAutoRevisions: 2 });
    const runnerFactory = vi.fn((_options: { baseConfig: PipelineConfig; policy: VolumeProductionPolicyV1 }) =>
      fakeRunner(async () => pipelineResult()));

    await makeOrchestrator({
      policyResolver: { resolve: async () => policy },
      runnerFactory,
    }).produceNextChapter({ bookId: "factory-book" });

    expect(runnerFactory).toHaveBeenCalledTimes(1);
    expect(runnerFactory.mock.calls[0]![0]).toMatchObject({ policy: { maxAutoRevisions: 2 } });
  });

  it("requires basePipelineConfig when no runner factory is injected", () => {
    expect(() => new VolumeProductionOrchestrator({ projectRoot })).toThrowError(TypeError);
  });
});

describe("single runner call and zero commercial retries (FR-B02/FR-B03/FR-B05)", () => {
  it("calls writeNextChapter exactly once on success", async () => {
    const runner = fakeRunner(async () => pipelineResult());

    const result = await makeOrchestrator({ runnerFactory: () => runner }).produceNextChapter({ bookId: "single-call" });

    expect(runner.writeNextChapter).toHaveBeenCalledTimes(1);
    expect(runner.writeNextChapter).toHaveBeenCalledWith("single-call");
    expect(result).toMatchObject({
      runId: "run-1",
      bookId: "single-call",
      chapterNumber: 1,
      productionStatus: "awaiting_manual_review",
      pipelineStatus: "ready-for-review",
      releaseEligible: false,
    });
  });

  it("does not retry the full pipeline and pauses the book after a runner error", async () => {
    const failure = new Error("provider exploded");
    const runner = fakeRunner(async () => { throw failure; });
    const orchestratorInstance = makeOrchestrator({
      stateManager: seqNextChapter([1, 1, 1]),
      runnerFactory: () => runner,
    });

    const result = await orchestratorInstance.produceNextChapter({ bookId: "no-retry" });

    expect(runner.writeNextChapter).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ productionStatus: "paused", stopReason: "PRODUCTION_PIPELINE_FAILED", releaseEligible: false });
    expect(result.failureCause).toBe(failure);

    await expect(orchestratorInstance.produceNextChapter({ bookId: "no-retry" })).rejects.toMatchObject({
      name: "VolumeProductionStateError",
      code: "PRODUCTION_BOOK_PAUSED",
    });
    expect(runner.writeNextChapter).toHaveBeenCalledTimes(1);
  });

  it("pauses without calling the Runner when the pre-run chapter number drifts", async () => {
    const runner = fakeRunner(async () => pipelineResult());

    const result = await makeOrchestrator({
      stateManager: seqNextChapter([1, 2]),
      runnerFactory: () => runner,
    }).produceNextChapter({ bookId: "pre-drift" });

    expect(runner.writeNextChapter).not.toHaveBeenCalled();
    expect(result).toMatchObject({ productionStatus: "paused", stopReason: "CHAPTER_NUMBER_MISMATCH" });
    expect(await realStore().load("pre-drift")).toMatchObject({ bookProductionStatus: "paused" });
  });

  it("pauses when result.chapterNumber does not match the expected chapter", async () => {
    const result = await makeOrchestrator({
      runnerFactory: () => fakeRunner(async () => pipelineResult({ chapterNumber: 2 })),
    }).produceNextChapter({ bookId: "post-drift" });

    expect(result).toMatchObject({ chapterNumber: 2, productionStatus: "paused", stopReason: "CHAPTER_NUMBER_MISMATCH" });
    expect(await realStore().load("post-drift")).toMatchObject({ bookProductionStatus: "paused" });
  });

  it("allows exactly one concurrent commercial run per book", async () => {
    let release!: (value: ChapterPipelineResult) => void;
    const gate = new Promise<ChapterPipelineResult>((resolveGate) => { release = resolveGate; });
    const runner = fakeRunner(() => gate);
    let runCounter = 0;
    const orchestratorInstance = makeOrchestrator({
      stateManager: seqNextChapter([1, 1, 1, 2]),
      runnerFactory: () => runner,
      runIdFactory: () => "run-" + String(++runCounter),
    });

    const first = orchestratorInstance.produceNextChapter({ bookId: "mutex-book" });
    await vi.waitFor(() => expect(runner.writeNextChapter).toHaveBeenCalledTimes(1));

    await expect(orchestratorInstance.produceNextChapter({ bookId: "mutex-book" })).rejects.toMatchObject({
      name: "VolumeProductionStateError",
      code: "PRODUCTION_ALREADY_RUNNING",
    });

    release(pipelineResult());
    await expect(first).resolves.toMatchObject({ productionStatus: "awaiting_manual_review" });
    expect(runner.writeNextChapter).toHaveBeenCalledTimes(1);
  });

  it("keeps two books isolated", async () => {
    const orchestratorA = makeOrchestrator({ runIdFactory: () => "run-a" });
    const orchestratorB = makeOrchestrator({
      stateManager: seqNextChapter([1, 1, 2]),
      runnerFactory: () => fakeRunner(async () => { throw new Error("boom"); }),
      runIdFactory: () => "run-b",
    });

    await orchestratorA.produceNextChapter({ bookId: "book-one" });
    await orchestratorB.produceNextChapter({ bookId: "book-two" });

    expect(await realStore().load("book-one")).toMatchObject({ bookProductionStatus: "active" });
    expect(await realStore().load("book-two")).toMatchObject({ bookProductionStatus: "paused" });
    expect(statePath("book-one")).not.toBe(statePath("book-two"));
  });
});

describe("timeout and abort (FR-B06)", () => {
  it("aborts through the runner after exactly 60 minutes and pauses with PRODUCTION_TIMEOUT", async () => {
    vi.useFakeTimers();
    const pauseActiveRun = vi.fn(async () => ({}) as VolumeProductionStateV1);
    const promise = makeOrchestrator({
      stateStore: {
        startRun: vi.fn(async () => ({}) as VolumeProductionStateV1),
        completeRun: vi.fn(async () => ({}) as VolumeProductionStateV1),
        pauseActiveRun,
      },
      stateManager: seqNextChapter([1, 1]),
      runnerFactory: () => fakeRunner(() => new Promise<ChapterPipelineResult>(() => undefined)),
    }).produceNextChapter({ bookId: "timeout-book" });

    await vi.advanceTimersByTimeAsync(VOLUME_PRODUCTION_RUN_TIMEOUT_MS - 1);
    expect(pauseActiveRun).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;

    expect(result).toMatchObject({ productionStatus: "paused", stopReason: "PRODUCTION_TIMEOUT" });
    expect(result.failureCause).toBeUndefined();
    expect(pauseActiveRun).toHaveBeenCalledWith(expect.objectContaining({ stopReason: "PRODUCTION_TIMEOUT" }));
  });

  it("maps a caller abort to PRODUCTION_ABORTED, distinct from timeout", async () => {
    const controller = new AbortController();
    const runner = fakeRunner(() => new Promise<ChapterPipelineResult>(() => undefined));
    const promise = makeOrchestrator({
      stateManager: seqNextChapter([1, 1]),
      runnerFactory: () => runner,
    }).produceNextChapter({ bookId: "abort-book", signal: controller.signal });

    await vi.waitFor(() => expect(runner.writeNextChapter).toHaveBeenCalledTimes(1));
    controller.abort();

    await expect(promise).resolves.toMatchObject({ productionStatus: "paused", stopReason: "PRODUCTION_ABORTED" });
    expect(await realStore().load("abort-book")).toMatchObject({ bookProductionStatus: "paused" });
  });

  it("treats a pre-aborted signal as PRODUCTION_ABORTED without executing the chapter task", async () => {
    const controller = new AbortController();
    controller.abort();
    const runner = fakeRunner(async () => pipelineResult());

    const result = await makeOrchestrator({
      stateManager: seqNextChapter([1, 1]),
      runnerFactory: () => runner,
    }).produceNextChapter({ bookId: "pre-aborted", signal: controller.signal });

    expect(result).toMatchObject({ productionStatus: "paused", stopReason: "PRODUCTION_ABORTED" });
    expect(runner.writeNextChapter).not.toHaveBeenCalled();
  });

  it("cleans up the timer and the abort listener after a completed run", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");

    const result = await makeOrchestrator().produceNextChapter({ bookId: "cleanup-book", signal: controller.signal });

    expect(result.productionStatus).toBe("awaiting_manual_review");
    expect(vi.getTimerCount()).toBe(0);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});

describe("pipeline result mapping (FR-B07/FR-B10)", () => {
  async function produceWith(bookId: string, result: ChapterPipelineResult) {
    return makeOrchestrator({
      runnerFactory: () => fakeRunner(async () => result),
    }).produceNextChapter({ bookId });
  }

  it("maps ready-for-review to awaiting manual review", async () => {
    const result = await produceWith("map-ready", pipelineResult());

    expect(result).toMatchObject({ productionStatus: "awaiting_manual_review", pipelineStatus: "ready-for-review" });
    expect(result.stopReason).toBeUndefined();
    expect(await realStore().load("map-ready")).toMatchObject({ bookProductionStatus: "active" });
  });

  it("maps warning-only audit-failed, derived from issues, to awaiting manual review", async () => {
    const result = await produceWith("map-warning", pipelineResult({ status: "audit-failed", severities: ["warning", "info"] }));

    expect(result).toMatchObject({
      productionStatus: "awaiting_manual_review",
      pipelineStatus: "audit-failed",
      stopReason: "WARNING_OVERRIDE_REQUIRED",
    });
  });

  it("pauses on critical issues", async () => {
    const result = await produceWith("map-critical", pipelineResult({ status: "audit-failed", severities: ["warning", "critical"] }));

    expect(result).toMatchObject({ productionStatus: "paused", stopReason: "AUDIT_CRITICAL" });
    expect(await realStore().load("map-critical")).toMatchObject({ bookProductionStatus: "paused" });
  });

  it("pauses on audit parse failure", async () => {
    const result = await produceWith("map-parse", pipelineResult({ status: "audit-failed", parseFailed: true }));

    expect(result).toMatchObject({ productionStatus: "paused", stopReason: "AUDIT_PARSE_FAILED" });
  });

  it("pauses when the final word count leaves the soft range", async () => {
    const result = await produceWith("map-length", pipelineResult({ wordCount: 2000 }));

    expect(result).toMatchObject({ productionStatus: "paused", stopReason: "LENGTH_OUT_OF_POLICY" });
  });

  it("pauses on state-degraded", async () => {
    const result = await produceWith("map-degraded", pipelineResult({ status: "state-degraded" }));

    expect(result).toMatchObject({ productionStatus: "paused", stopReason: "STATE_DEGRADED", pipelineStatus: "state-degraded" });
  });

  it("pauses audit-failed without warnings as AUDIT_FAILED", async () => {
    const result = await produceWith("map-audit-failed", pipelineResult({ status: "audit-failed" }));

    expect(result).toMatchObject({ productionStatus: "paused", stopReason: "AUDIT_FAILED" });
  });

  it("never classifies runner errors by message text", async () => {
    const misleading = new Error("timeout: context length exceeded while BOOK_BUSY aborted");
    const result = await makeOrchestrator({
      runnerFactory: () => fakeRunner(async () => { throw misleading; }),
    }).produceNextChapter({ bookId: "map-error-text" });

    expect(result).toMatchObject({ productionStatus: "paused", stopReason: "PRODUCTION_PIPELINE_FAILED" });
    expect(result.failureCause).toBe(misleading);
  });

  it("passes tokenUsage through from the pipeline result only and never persists it", async () => {
    const tokenUsage = { promptTokens: 10, completionTokens: 20, totalTokens: 30 };
    const withTokens = await produceWith("map-tokens", pipelineResult({ tokenUsage }));
    const withoutTokens = await produceWith("map-no-tokens", pipelineResult());

    expect(withTokens.tokenUsage).toEqual(tokenUsage);
    expect(withoutTokens.tokenUsage).toBeUndefined();
    expect(await readFile(statePath("map-tokens"), "utf-8")).not.toContain("tokenUsage");
  });
});

describe("production settled events (TASK-004B)", () => {
  it("keeps the no-events result shape identical to TASK-003B", async () => {
    const result = await makeOrchestrator().produceNextChapter({ bookId: "book-a" });
    expect(result).toEqual({
      runId: "run-1",
      bookId: "book-a",
      chapterNumber: 1,
      productionStatus: "awaiting_manual_review",
      pipelineStatus: "ready-for-review",
      releaseEligible: false,
    });
    expect(Object.keys(result).sort()).toEqual([
      "bookId",
      "chapterNumber",
      "pipelineStatus",
      "productionStatus",
      "releaseEligible",
      "runId",
    ]);
  });

  it("awaits one deep-frozen independent snapshot after terminal state and lock release", async () => {
    const usage = {
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      cache: { hits: 2 },
    };
    let captured: VolumeProductionSettledEvent | undefined;
    let callbackCount = 0;
    const orchestrator = makeOrchestrator({
      runnerFactory: () => fakeRunner(async () => pipelineResult({ tokenUsage: usage })),
      events: {
        onProductionSettled: async (event) => {
          callbackCount += 1;
          const state = JSON.parse(await readFile(statePath("book-a"), "utf-8")) as VolumeProductionStateV1;
          expect(state.activeRun).toBeUndefined();
          expect(state.chapters["1"]?.currentStatus).toBe("awaiting_manual_review");
          const release = await new StateManager(projectRoot).acquireBookLock("book-a");
          await release();
          expect(Object.isFrozen(event)).toBe(true);
          expect(Object.isFrozen(event.result)).toBe(true);
          expect(Object.isFrozen(event.result.tokenUsage)).toBe(true);
          expect(Object.isFrozen((event.result.tokenUsage as typeof usage).cache)).toBe(true);
          expect(() => {
            (event.result as { bookId: string }).bookId = "mutated";
          }).toThrow();
          captured = event;
        },
      },
    });

    const result = await orchestrator.produceNextChapter({ bookId: "book-a" });
    usage.cache.hits = 99;
    expect(callbackCount).toBe(1);
    expect(captured?.result).not.toBe(result);
    expect((captured?.result.tokenUsage as typeof usage).cache.hits).toBe(2);
  });

  it("emits settled after a paused terminal state", async () => {
    const events: VolumeProductionSettledEvent[] = [];
    const result = await makeOrchestrator({
      stateManager: seqNextChapter([1, 2]),
      events: { onProductionSettled: (event) => { events.push(event); } },
    }).produceNextChapter({ bookId: "book-a" });

    expect(result.productionStatus).toBe("paused");
    expect(events).toHaveLength(1);
    expect(events[0]?.result.stopReason).toBe("CHAPTER_NUMBER_MISMATCH");
    const state = JSON.parse(await readFile(statePath("book-a"), "utf-8")) as VolumeProductionStateV1;
    expect(state.activeRun).toBeUndefined();
    expect(state.bookProductionStatus).toBe("paused");
  });

  it("catches callback errors and preserves the production result", async () => {
    const logger = { warn: vi.fn() };
    const result = await makeOrchestrator({
      events: { onProductionSettled: async () => { throw new Error("ledger unavailable"); } },
      logger,
    }).produceNextChapter({ bookId: "book-a" });

    expect(result.productionStatus).toBe("awaiting_manual_review");
    expect(result).not.toHaveProperty("ledgerWriteFailed");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("production result is unchanged"),
      expect.objectContaining({ bookId: "book-a", runId: "run-1" }),
    );
  });
});

describe("manual review API (FR-B08/FR-B09)", () => {
  function reviewService(): VolumeProductionReviewService {
    return new VolumeProductionReviewService({ projectRoot, stateStore: realStore() });
  }

  async function produceAwaiting(bookId: string): Promise<void> {
    const result = await makeOrchestrator().produceNextChapter({ bookId });
    expect(result.productionStatus).toBe("awaiting_manual_review");
  }

  it("supports approve, reject, and request_revision and gates release eligibility", async () => {
    const service = reviewService();
    const cases = [
      { bookId: "review-approve", decision: "approve", status: "approved", eligible: true },
      { bookId: "review-reject", decision: "reject", status: "rejected", eligible: false },
      { bookId: "review-revise", decision: "request_revision", status: "revision_requested", eligible: false },
    ] as const;

    for (const testCase of cases) {
      await produceAwaiting(testCase.bookId);
      expect(await service.releaseEligible(testCase.bookId, 1)).toBe(false);

      const record = await service.reviewChapter({
        bookId: testCase.bookId,
        chapterNumber: 1,
        runId: "run-1",
        decision: testCase.decision,
        note: "note",
      });

      expect(record.currentStatus).toBe(testCase.status);
      expect(record.reviews).toHaveLength(1);
      expect(await service.releaseEligible(testCase.bookId, 1)).toBe(testCase.eligible);
    }
  });

  it("rejects reviews for missing chapters, stale runIds, duplicates, and paused chapters", async () => {
    const service = reviewService();
    await produceAwaiting("review-guard");

    await expect(service.reviewChapter({ bookId: "review-guard", chapterNumber: 9, runId: "run-1", decision: "approve" }))
      .rejects.toMatchObject({ code: "PRODUCTION_INVALID_TRANSITION" });
    await expect(service.reviewChapter({ bookId: "review-guard", chapterNumber: 1, runId: "stale", decision: "approve" }))
      .rejects.toMatchObject({ code: "PRODUCTION_INVALID_TRANSITION" });

    await service.reviewChapter({ bookId: "review-guard", chapterNumber: 1, runId: "run-1", decision: "approve" });
    await expect(service.reviewChapter({ bookId: "review-guard", chapterNumber: 1, runId: "run-1", decision: "reject" }))
      .rejects.toMatchObject({ code: "PRODUCTION_INVALID_TRANSITION" });

    await makeOrchestrator({
      stateManager: seqNextChapter([2, 2, 2]),
      runnerFactory: () => fakeRunner(async () => { throw new Error("boom"); }),
      runIdFactory: () => "run-2",
    }).produceNextChapter({ bookId: "review-guard" });
    await expect(service.reviewChapter({ bookId: "review-guard", chapterNumber: 2, runId: "run-2", decision: "approve" }))
      .rejects.toMatchObject({ code: "PRODUCTION_INVALID_TRANSITION" });
  });
});

describe("story data boundary", () => {
  it("touches nothing outside commercial/volume-production-state.json", async () => {
    await makeOrchestrator().produceNextChapter({ bookId: "boundary-book" });
    await new VolumeProductionReviewService({ projectRoot, stateStore: realStore() })
      .reviewChapter({ bookId: "boundary-book", chapterNumber: 1, runId: "run-1", decision: "approve" });

    const entries = await readdir(join(projectRoot, "books", "boundary-book"), { recursive: true, withFileTypes: true });
    const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));

    expect(files).toEqual([statePath("boundary-book")]);
    const raw = await readFile(statePath("boundary-book"), "utf-8");
    expect(raw).not.toContain("ChapterMeta");
    expect(raw).not.toContain("tokenUsage");
  });

  it("never references the internal review cycle, review commands, or ChapterMeta", async () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const sources = await Promise.all([
      readFile(resolve(testDir, "..", "commercial", "volume-production-orchestrator.ts"), "utf-8"),
      readFile(resolve(testDir, "..", "commercial", "volume-production-review.ts"), "utf-8"),
    ]);

    for (const source of sources) {
      expect(source).not.toContain("runChapterReviewCycle");
      expect(source).not.toContain("chapter-review-cycle");
      expect(source).not.toContain("commands/review");
      expect(source).not.toContain("ChapterMeta");
      expect(source).not.toContain("models/chapter");
    }
  });
});
