import { randomUUID } from "node:crypto";
import type { ChapterPipelineResult, PipelineConfig, TokenUsageSummary } from "../pipeline/runner.js";
import { PipelineRunner } from "../pipeline/runner.js";
import { StateManager } from "../state/manager.js";
import { VolumeProductionPolicyResolver, type VolumeProductionPolicyV1 } from "./volume-production-policy.js";
import {
  VolumeProductionStateStore,
  mapVolumePipelineObservation,
  summarizeChapterPipelineResult,
  type VolumeChapterProductionStatus,
  type VolumePipelineStatus,
  type VolumeProductionStopReason,
} from "./volume-production-state.js";

/**
 * Minimal surface the orchestrator needs from a pipeline runner. The real
 * PipelineRunner satisfies this; tests may inject fakes. The orchestrator
 * never calls internal pipeline stages, agents, or the internal chapter
 * review cycle — writeNextChapter is the only production entry point.
 */
export interface VolumePipelineRunnerLike {
  runWithAbortSignal<T>(signal: AbortSignal | undefined, task: () => Promise<T>): Promise<T>;
  writeNextChapter(bookId: string): Promise<ChapterPipelineResult>;
}

export type VolumePipelineRunnerFactory = (options: {
  readonly baseConfig: PipelineConfig;
  readonly policy: VolumeProductionPolicyV1;
}) => VolumePipelineRunnerLike;

/**
 * Pure config merge for the commercial volume runner: keeps the caller's
 * base PipelineConfig (LLM client, model, logging, governance mode) but
 * forces the frozen volume policy knobs. projectRoot is pinned to the
 * orchestrator's own root so a stray base config cannot leak the run into
 * another project.
 */
export function buildVolumePipelineConfig(
  baseConfig: PipelineConfig,
  policy: VolumeProductionPolicyV1,
  projectRoot: string,
): PipelineConfig {
  return {
    ...baseConfig,
    projectRoot,
    chapterReviewMode: "auto",
    writingReviewRetries: policy.maxAutoRevisions,
  };
}

export type VolumeStateStoreForOrchestrator = Pick<
  VolumeProductionStateStore,
  "startRun" | "completeRun" | "pauseActiveRun"
>;

export interface VolumeProductionOrchestratorOptions {
  readonly projectRoot: string;
  /** Base pipeline config used by the default runner factory. Required unless runnerFactory is injected. */
  readonly basePipelineConfig?: PipelineConfig;
  readonly policyResolver?: Pick<VolumeProductionPolicyResolver, "resolve">;
  readonly stateStore?: VolumeStateStoreForOrchestrator;
  readonly stateManager?: Pick<StateManager, "getNextChapterNumber">;
  readonly runnerFactory?: VolumePipelineRunnerFactory;
  readonly runIdFactory?: () => string;
}

export interface ProduceNextVolumeChapterInput {
  readonly bookId: string;
  readonly signal?: AbortSignal;
}

export interface VolumeProductionResult {
  readonly runId: string;
  readonly bookId: string;
  /** Actual chapter number when the runner returned; the expected chapter of the run otherwise. */
  readonly chapterNumber?: number;
  readonly productionStatus: VolumeChapterProductionStatus;
  readonly pipelineStatus?: VolumePipelineStatus;
  readonly releaseEligible: boolean;
  readonly stopReason?: VolumeProductionStopReason;
  /** Optional pass-through of ChapterPipelineResult.tokenUsage. Never persisted to commercial state. */
  readonly tokenUsage?: TokenUsageSummary;
  /** Diagnostic cause for PRODUCTION_PIPELINE_FAILED. Never persisted and never parsed for classification. */
  readonly failureCause?: unknown;
}

export class VolumeProductionOrchestrator {
  private readonly projectRoot: string;
  private readonly policyResolver: Pick<VolumeProductionPolicyResolver, "resolve">;
  private readonly stateStore: VolumeStateStoreForOrchestrator;
  private readonly stateManager: Pick<StateManager, "getNextChapterNumber">;
  private readonly runnerFactory: VolumePipelineRunnerFactory;
  private readonly runIdFactory: () => string;
  private readonly basePipelineConfig?: PipelineConfig;

  constructor(options: VolumeProductionOrchestratorOptions) {
    if (!options.runnerFactory && !options.basePipelineConfig) {
      throw new TypeError("VolumeProductionOrchestrator requires basePipelineConfig or an injected runnerFactory");
    }
    this.projectRoot = options.projectRoot;
    this.policyResolver = options.policyResolver ?? new VolumeProductionPolicyResolver({ projectRoot: options.projectRoot });
    this.stateStore = options.stateStore ?? new VolumeProductionStateStore(options.projectRoot);
    this.stateManager = options.stateManager ?? new StateManager(options.projectRoot);
    this.runnerFactory = options.runnerFactory
      ?? (({ baseConfig, policy }) => new PipelineRunner(buildVolumePipelineConfig(baseConfig, policy, this.projectRoot)));
    this.basePipelineConfig = options.basePipelineConfig;
    this.runIdFactory = options.runIdFactory ?? randomUUID;
  }

  async produceNextChapter(input: ProduceNextVolumeChapterInput): Promise<VolumeProductionResult> {
    const bookId = input.bookId;
    // FR-B01: resolve first; flagship rejects here, before any run or Runner.
    const policy = await this.policyResolver.resolve(bookId);

    // FR-B03: expected chapter before the run. Accepts the documented
    // structured-state bootstrap side effect of getNextChapterNumber.
    const expectedChapterNumber = await this.stateManager.getNextChapterNumber(bookId);

    // FR-B02: short lock transaction inside startRun guarantees the book is
    // active, has no activeRun, and records this runId exclusively.
    const runId = this.runIdFactory();
    await this.stateStore.startRun({ bookId, runId, expectedChapterNumber });

    // FR-B03: re-check before touching the Runner; any drift pauses without
    // a single Runner call.
    const recheckedChapterNumber = await this.stateManager.getNextChapterNumber(bookId);
    if (recheckedChapterNumber !== expectedChapterNumber) {
      return this.pause(bookId, runId, expectedChapterNumber, "CHAPTER_NUMBER_MISMATCH");
    }

    const runner = this.runnerFactory({
      // The default factory path guarantees basePipelineConfig via the
      // constructor guard; injected factories may ignore it.
      baseConfig: this.basePipelineConfig as PipelineConfig,
      policy,
    });

    // FR-B06: writeNextChapter takes no signal. Combine the caller's signal
    // and the frozen 60-minute timer on an internal controller, and hand it
    // to the Runner's public runWithAbortSignal instance method.
    const controller = new AbortController();
    let timedOut = false;
    let userAborted = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, policy.runTimeoutMs);
    const onUserAbort = () => {
      userAborted = true;
      controller.abort();
    };
    if (input.signal) {
      if (input.signal.aborted) onUserAbort();
      else input.signal.addEventListener("abort", onUserAbort, { once: true });
    }

    let result: ChapterPipelineResult;
    try {
      // FR-B04/FR-B05: exactly one writeNextChapter call, zero commercial retries.
      result = await runner.runWithAbortSignal(controller.signal, () => runner.writeNextChapter(bookId));
    } catch (error) {
      // FR-B07: stable stop reasons from our own flags — never from error text.
      const stopReason: VolumeProductionStopReason = timedOut
        ? "PRODUCTION_TIMEOUT"
        : userAborted
          ? "PRODUCTION_ABORTED"
          : "PRODUCTION_PIPELINE_FAILED";
      return this.pause(bookId, runId, expectedChapterNumber, stopReason, stopReason === "PRODUCTION_PIPELINE_FAILED" ? error : undefined);
    } finally {
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onUserAbort);
    }

    // FR-B07: normalize the public result via the TASK-003A pure functions;
    // completeRun applies the same deterministic mapping under the book lock.
    const observation = summarizeChapterPipelineResult(result, policy);
    const observedNextChapterAfterRun = await this.stateManager.getNextChapterNumber(bookId);
    await this.stateStore.completeRun({ bookId, runId, observation, observedNextChapterAfterRun });
    const mapping = mapVolumePipelineObservation(observation, expectedChapterNumber);

    return {
      runId,
      bookId,
      chapterNumber: observation.actualChapterNumber,
      productionStatus: mapping.chapterStatus,
      pipelineStatus: observation.auditGate.pipelineStatus,
      // A fresh run is never release-eligible: manual approval is mandatory (FR-B09).
      releaseEligible: false,
      ...(mapping.stopReason !== undefined ? { stopReason: mapping.stopReason } : {}),
      // FR-B10: pass-through only, never re-aggregated, never persisted.
      ...(result.tokenUsage !== undefined ? { tokenUsage: result.tokenUsage } : {}),
    };
  }

  private async pause(
    bookId: string,
    runId: string,
    expectedChapterNumber: number,
    stopReason: VolumeProductionStopReason,
    failureCause?: unknown,
  ): Promise<VolumeProductionResult> {
    await this.stateStore.pauseActiveRun({ bookId, runId, stopReason });
    return {
      runId,
      bookId,
      chapterNumber: expectedChapterNumber,
      productionStatus: "paused",
      releaseEligible: false,
      stopReason,
      ...(failureCause !== undefined ? { failureCause } : {}),
    };
  }
}
