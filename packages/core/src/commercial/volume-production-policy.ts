import { z } from "zod";
import type { BookConfig } from "../models/book.js";
import type { ProjectConfig } from "../models/project.js";
import { StateManager } from "../state/manager.js";
import { loadProjectConfig as defaultLoadProjectConfig } from "../utils/config-loader.js";
import { buildLengthSpec as defaultBuildLengthSpec } from "../utils/length-metrics.js";
import { BookStrategyStore } from "./book-strategy.js";

export const VOLUME_PRODUCTION_POLICY_SCHEMA_VERSION = 1 as const;
export const VOLUME_PRODUCTION_RUN_TIMEOUT_MS = 3_600_000 as const;

export const VolumeProductionPolicySchema = z.object({
  schemaVersion: z.literal(VOLUME_PRODUCTION_POLICY_SCHEMA_VERSION),
  mode: z.literal("volume"),
  chaptersPerRun: z.literal(1),
  auditRequired: z.literal(true),
  targetChapterWords: z.number().int().min(1),
  maxAutoRevisions: z.number().int().min(0),
  wordTolerance: z.object({
    source: z.literal("length_spec_soft_range"),
    softMin: z.number().int().min(1),
    softMax: z.number().int().min(1),
  }).strict(),
  manualApprovalRequired: z.literal(true),
  allowApprovalWithWarnings: z.literal(true),
  maxPipelineRetries: z.literal(0),
  runTimeoutMs: z.literal(VOLUME_PRODUCTION_RUN_TIMEOUT_MS),
  failureAction: z.literal("pause_book"),
}).strict();

export type VolumeProductionPolicyV1 = z.infer<typeof VolumeProductionPolicySchema>;

export type VolumeProductionPolicyErrorCode =
  | "PRODUCTION_MODE_LOAD_FAILED"
  | "PRODUCTION_POLICY_NOT_IMPLEMENTED";

export class VolumeProductionPolicyError extends Error {
  constructor(
    readonly code: VolumeProductionPolicyErrorCode,
    readonly bookId: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "VolumeProductionPolicyError";
  }
}

export interface VolumeProductionPolicyResolverOptions {
  readonly projectRoot: string;
  readonly bookStrategyStore?: Pick<BookStrategyStore, "load">;
  readonly stateManager?: Pick<StateManager, "loadBookConfig">;
  readonly loadProjectConfig?: typeof defaultLoadProjectConfig;
  readonly buildLengthSpec?: typeof defaultBuildLengthSpec;
}

export class VolumeProductionPolicyResolver {
  private readonly projectRoot: string;
  private readonly bookStrategyStore: Pick<BookStrategyStore, "load">;
  private readonly stateManager: Pick<StateManager, "loadBookConfig">;
  private readonly loadProjectConfig: typeof defaultLoadProjectConfig;
  private readonly buildLengthSpec: typeof defaultBuildLengthSpec;

  constructor(options: VolumeProductionPolicyResolverOptions) {
    this.projectRoot = options.projectRoot;
    this.bookStrategyStore = options.bookStrategyStore ?? new BookStrategyStore(options.projectRoot);
    this.stateManager = options.stateManager ?? new StateManager(options.projectRoot);
    this.loadProjectConfig = options.loadProjectConfig ?? defaultLoadProjectConfig;
    this.buildLengthSpec = options.buildLengthSpec ?? defaultBuildLengthSpec;
  }

  async resolve(bookId: string): Promise<VolumeProductionPolicyV1> {
    let book: BookConfig;
    let project: ProjectConfig;

    try {
      const strategy = await this.bookStrategyStore.load(bookId);
      if (strategy.productionMode === "flagship") {
        throw new VolumeProductionPolicyError(
          "PRODUCTION_POLICY_NOT_IMPLEMENTED",
          bookId,
          "Commercial production policy for flagship mode is not implemented",
        );
      }

      book = await this.stateManager.loadBookConfig(bookId);
      project = await this.loadProjectConfig(this.projectRoot, { requireApiKey: false });
    } catch (error) {
      if (error instanceof VolumeProductionPolicyError) throw error;
      throw new VolumeProductionPolicyError(
        "PRODUCTION_MODE_LOAD_FAILED",
        bookId,
        "Failed to resolve volume production policy for book " + JSON.stringify(bookId),
        error,
      );
    }

    const lengthSpec = this.buildLengthSpec(book.chapterWordCount);
    return VolumeProductionPolicySchema.parse({
      schemaVersion: VOLUME_PRODUCTION_POLICY_SCHEMA_VERSION,
      mode: "volume",
      chaptersPerRun: 1,
      auditRequired: true,
      targetChapterWords: book.chapterWordCount,
      maxAutoRevisions: project.writing?.reviewRetries ?? 1,
      wordTolerance: {
        source: "length_spec_soft_range",
        softMin: lengthSpec.softMin,
        softMax: lengthSpec.softMax,
      },
      manualApprovalRequired: true,
      allowApprovalWithWarnings: true,
      maxPipelineRetries: 0,
      runTimeoutMs: VOLUME_PRODUCTION_RUN_TIMEOUT_MS,
      failureAction: "pause_book",
    });
  }
}
