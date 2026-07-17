import { readFile } from "node:fs/promises";
import type { PipelineConfig } from "../pipeline/runner.js";
import type { Logger } from "../utils/logger.js";
import {
  CostLedgerError,
  CostLedgerStore,
  type CostLedgerCostV1,
  type CostLedgerEntryV1,
  type CostLedgerTokenUsageV1,
  type CostUnavailableReason,
} from "./cost-ledger.js";
import {
  ModelPriceTableError,
  computeCost,
  loadModelPriceTable,
  type ModelPriceTableV1,
} from "./model-price-table.js";
import type { VolumeProductionSettledEvent } from "./volume-production-orchestrator.js";

export type CostLedgerRecorderPipelineConfig = Pick<PipelineConfig, "model" | "modelOverrides">;

export type CostLedgerRecorderStore = Pick<CostLedgerStore, "append" | "recordWriteFailure">;

export interface CostLedgerRecorderOptions {
  readonly projectRoot: string;
  readonly pipelineConfig: CostLedgerRecorderPipelineConfig;
  readonly store?: CostLedgerRecorderStore;
  readonly priceTableLoader?: (projectRoot: string) => Promise<ModelPriceTableV1 | undefined>;
  readonly inkosVersionLoader?: () => Promise<string>;
  readonly logger?: Pick<Logger, "warn" | "error">;
}

const fallbackLogger: Pick<Logger, "warn" | "error"> = {
  warn(message, context) {
    console.warn("[cost-ledger] " + message, context ?? {});
  },
  error(message, context) {
    console.error("[cost-ledger] " + message, context ?? {});
  },
};

async function loadCorePackageVersion(): Promise<string> {
  const raw = await readFile(new URL("../../package.json", import.meta.url), "utf-8");
  const parsed = JSON.parse(raw) as { readonly version?: unknown };
  if (typeof parsed.version !== "string" || parsed.version.length === 0) {
    throw new TypeError("Core package version is missing or invalid");
  }
  return parsed.version;
}

function extractOverrideModels(config: CostLedgerRecorderPipelineConfig): ReadonlyArray<string> {
  const models = Object.values(config.modelOverrides ?? {}).map((override) =>
    typeof override === "string" ? override : override.model,
  );
  return [...new Set(models)].sort();
}

function extractUsage(
  event: VolumeProductionSettledEvent,
  logger: Pick<Logger, "warn">,
): {
  readonly tokenUsage?: CostLedgerTokenUsageV1;
  readonly usageExtra?: Readonly<Record<string, unknown>>;
} {
  if (event.result.tokenUsage === undefined) return {};
  const raw = event.result.tokenUsage as unknown as Readonly<Record<string, unknown>>;
  const tokenUsage = {
    promptTokens: raw.promptTokens as number,
    completionTokens: raw.completionTokens as number,
    totalTokens: raw.totalTokens as number,
  };
  const usageExtra = Object.fromEntries(
    Object.entries(raw).filter(([key]) =>
      key !== "promptTokens" && key !== "completionTokens" && key !== "totalTokens",
    ),
  );
  if (Object.keys(usageExtra).length > 0) {
    logger.warn("Preserving unknown token usage fields in cost ledger usageExtra", {
      bookId: event.result.bookId,
      runId: event.result.runId,
      fields: Object.keys(usageExtra).sort(),
    });
  }
  return {
    tokenUsage,
    ...(Object.keys(usageExtra).length > 0 ? { usageExtra } : {}),
  };
}

export class CostLedgerRecorder {
  private readonly store: CostLedgerRecorderStore;
  private readonly priceTableLoader: (projectRoot: string) => Promise<ModelPriceTableV1 | undefined>;
  private readonly inkosVersionLoader: () => Promise<string>;
  private readonly logger: Pick<Logger, "warn" | "error">;
  private readonly model: string;
  private readonly overrideModels: ReadonlyArray<string>;
  private readonly projectRoot: string;

  constructor(options: CostLedgerRecorderOptions) {
    this.projectRoot = options.projectRoot;
    this.store = options.store ?? new CostLedgerStore(options.projectRoot);
    this.priceTableLoader = options.priceTableLoader ?? loadModelPriceTable;
    this.inkosVersionLoader = options.inkosVersionLoader ?? loadCorePackageVersion;
    this.logger = options.logger ?? fallbackLogger;
    this.model = options.pipelineConfig.model;
    this.overrideModels = Object.freeze([...extractOverrideModels(options.pipelineConfig)]);
  }

  readonly onProductionSettled = async (event: VolumeProductionSettledEvent): Promise<void> => {
    await this.record(event);
  };

  /**
   * Records a settled commercial run. This method is deliberately fail-open:
   * callers always retain the production result, while failures are made loud
   * through logging and the durable missed-run marker.
   */
  async record(event: VolumeProductionSettledEvent): Promise<CostLedgerEntryV1 | undefined> {
    try {
      const usage = extractUsage(event, this.logger);
      const pricing = await this.resolvePricing(usage.tokenUsage, this.overrideModels.length > 0);
      const inkosVersion = await this.inkosVersionLoader();
      return await this.store.append(event.result.bookId, {
        runId: event.result.runId,
        bookId: event.result.bookId,
        ...(event.result.chapterNumber !== undefined ? { chapterNumber: event.result.chapterNumber } : {}),
        productionStatus: event.result.productionStatus,
        ...(event.result.pipelineStatus !== undefined ? { pipelineStatus: event.result.pipelineStatus } : {}),
        ...(event.result.stopReason !== undefined ? { stopReason: event.result.stopReason } : {}),
        ...usage,
        inkosVersion,
        model: this.model,
        ...(this.overrideModels.length > 0 ? { overrideModels: this.overrideModels } : {}),
        ...pricing,
      });
    } catch (error) {
      const errorCode = error instanceof CostLedgerError ? error.code : "LEDGER_WRITE_FAILED";
      this.logger.warn("Failed to record settled production cost; production result is unchanged", {
        bookId: event.result.bookId,
        runId: event.result.runId,
        errorCode,
      });
      if (error instanceof CostLedgerError && error.code === "LEDGER_DUPLICATE_RUN") {
        return undefined;
      }
      const marker = await this.store.recordWriteFailure(event.result.bookId, {
        errorCode,
        runId: event.result.runId,
      });
      if (marker === undefined) {
        this.logger.error("Failed to persist cost ledger write-failure marker", {
          bookId: event.result.bookId,
          runId: event.result.runId,
          errorCode,
        });
      }
      return undefined;
    }
  }

  private async resolvePricing(
    tokenUsage: CostLedgerTokenUsageV1 | undefined,
    approximate: boolean,
  ): Promise<
    | { readonly cost: CostLedgerCostV1 }
    | { readonly costUnavailableReason: CostUnavailableReason }
  > {
    if (tokenUsage === undefined) return { costUnavailableReason: "token_usage_missing" };

    let table: ModelPriceTableV1 | undefined;
    try {
      table = await this.priceTableLoader(this.projectRoot);
    } catch (error) {
      if (!(error instanceof ModelPriceTableError)) throw error;
      this.logger.warn("Model price table is invalid; recording tokens without a cost estimate", {
        errorCode: error.code,
      });
      return { costUnavailableReason: "price_table_invalid" };
    }
    if (table === undefined) return { costUnavailableReason: "price_table_missing" };
    const price = table.models[this.model];
    if (price === undefined) return { costUnavailableReason: "model_not_found" };
    return {
      cost: computeCost({
        promptTokens: tokenUsage.promptTokens,
        completionTokens: tokenUsage.completionTokens,
        price,
        currency: table.currency,
        priceTableVersion: table.version,
        approximate,
      }),
    };
  }
}
