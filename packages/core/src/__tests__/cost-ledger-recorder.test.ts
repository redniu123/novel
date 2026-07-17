import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CostLedgerRecorder } from "../commercial/cost-ledger-recorder.js";
import {
  CostLedgerError,
  CostLedgerStore,
  type CostLedgerFailureMarkerV1,
} from "../commercial/cost-ledger.js";
import {
  ModelPriceTableError,
  type ModelPriceTableV1,
} from "../commercial/model-price-table.js";
import type {
  VolumeProductionEvents,
  VolumeProductionSettledEvent,
} from "../commercial/volume-production-orchestrator.js";

describe("cost ledger recorder", () => {
  let projectRoot: string;
  let store: CostLedgerStore;
  let logger: { warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-cost-recorder-"));
    store = new CostLedgerStore(projectRoot, { now: () => new Date("2026-07-17T00:00:00.000Z") });
    logger = { warn: vi.fn(), error: vi.fn() };
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  function settledEvent(
    overrides: Partial<VolumeProductionSettledEvent["result"]> = {},
  ): VolumeProductionSettledEvent {
    return {
      result: {
        runId: "run-1",
        bookId: "book-alpha",
        chapterNumber: 1,
        productionStatus: "awaiting_manual_review",
        pipelineStatus: "ready-for-review",
        releaseEligible: false,
        tokenUsage: { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
        ...overrides,
      },
    };
  }

  function table(models: ModelPriceTableV1["models"]): ModelPriceTableV1 {
    return {
      schemaVersion: 1,
      version: "2026-07-17",
      currency: "CNY",
      models,
    };
  }

  function recorder(options: {
    readonly priceTableLoader?: () => Promise<ModelPriceTableV1 | undefined>;
    readonly modelOverrides?: Record<string, string | {
      readonly model: string;
      readonly baseUrl?: string;
      readonly apiKeyEnv?: string;
    }>;
  } = {}): CostLedgerRecorder {
    return new CostLedgerRecorder({
      projectRoot,
      pipelineConfig: {
        model: "main-model",
        modelOverrides: options.modelOverrides,
      },
      store,
      priceTableLoader: options.priceTableLoader,
      inkosVersionLoader: async () => "1.7.0-test",
      logger,
    });
  }

  it("records exact cost, usageExtra, version, and model-only override identities", async () => {
    const usage = {
      promptTokens: 100,
      completionTokens: 200,
      totalTokens: 300,
      cachedPromptTokens: 40,
    };
    const result = await recorder({
      priceTableLoader: async () => table({
        "main-model": { promptPerMTokens: "2", completionPerMTokens: "3" },
      }),
      modelOverrides: {
        writer: { model: "override-b", baseUrl: "https://private.example/v1", apiKeyEnv: "SECRET_KEY" },
        auditor: "override-a",
        reviser: "override-b",
      },
    }).record(settledEvent({ tokenUsage: usage }));

    expect(result?.cost).toMatchObject({
      promptCost: "0.0002",
      completionCost: "0.0006",
      totalCost: "0.0008",
      approximate: true,
      priceTableVersion: "2026-07-17",
    });
    expect(result?.overrideModels).toEqual(["override-a", "override-b"]);
    expect(result?.usageExtra).toEqual({ cachedPromptTokens: 40 });
    expect(result?.inkosVersion).toBe("1.7.0-test");
    expect(JSON.stringify(result)).not.toContain("private.example");
    expect(JSON.stringify(result)).not.toContain("SECRET_KEY");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("usageExtra"),
      expect.objectContaining({ fields: ["cachedPromptTokens"] }),
    );
  });

  it("distinguishes missing, invalid, and unmatched price tables", async () => {
    const missing = await recorder({ priceTableLoader: async () => undefined }).record(
      settledEvent({ runId: "run-missing" }),
    );
    const invalid = await recorder({
      priceTableLoader: async () => { throw new ModelPriceTableError("broken"); },
    }).record(settledEvent({ runId: "run-invalid" }));
    const unmatched = await recorder({
      priceTableLoader: async () => table({ other: { promptPerMTokens: "1", completionPerMTokens: "1" } }),
    }).record(settledEvent({ runId: "run-unmatched" }));

    expect(missing?.costUnavailableReason).toBe("price_table_missing");
    expect(invalid?.costUnavailableReason).toBe("price_table_invalid");
    expect(unmatched?.costUnavailableReason).toBe("model_not_found");
  });

  it("records token_usage_missing without consulting the price table", async () => {
    const priceTableLoader = vi.fn(async () => table({}));
    const result = await recorder({ priceTableLoader }).record(
      settledEvent({ runId: "run-no-usage", tokenUsage: undefined }),
    );
    expect(result?.costUnavailableReason).toBe("token_usage_missing");
    expect(priceTableLoader).not.toHaveBeenCalled();
  });

  it("uses non-approximate pricing when no override models are configured", async () => {
    const result = await recorder({
      priceTableLoader: async () => table({
        "main-model": { promptPerMTokens: "1", completionPerMTokens: "1" },
      }),
    }).record(settledEvent());
    expect(result?.cost?.approximate).toBe(false);
    expect(result?.overrideModels).toBeUndefined();
  });

  it("snapshots the installed core package version by default", async () => {
    const target = new CostLedgerRecorder({
      projectRoot,
      pipelineConfig: { model: "main-model" },
      store,
      priceTableLoader: async () => undefined,
      logger,
    });
    const result = await target.record(settledEvent({ runId: "run-version" }));
    expect(result?.inkosVersion).toBe("1.7.0");
  });

  it("is idempotent by runId and does not create a false missed-run marker", async () => {
    const target = recorder({ priceTableLoader: async () => undefined });
    expect(await target.record(settledEvent())).toBeDefined();
    await expect(target.record(settledEvent())).resolves.toBeUndefined();
    expect(await store.read("book-alpha")).toHaveLength(1);
    expect(await store.readFailureMarker("book-alpha")).toBeUndefined();
  });

  it("snapshots model identity at construction instead of retaining a live config", async () => {
    const pipelineConfig = {
      model: "main-model",
      modelOverrides: { writer: { model: "override-model", baseUrl: "https://old.example/v1" } },
    };
    const target = new CostLedgerRecorder({
      projectRoot,
      pipelineConfig,
      store,
      priceTableLoader: async () => undefined,
      inkosVersionLoader: async () => "1.7.0",
      logger,
    });
    pipelineConfig.model = "mutated-model";
    pipelineConfig.modelOverrides.writer.model = "mutated-override";
    const entry = await target.record(settledEvent());
    expect(entry?.model).toBe("main-model");
    expect(entry?.overrideModels).toEqual(["override-model"]);
  });

  it("writes a real missed-run marker for invalid upstream usage and still resolves", async () => {
    const result = await recorder({ priceTableLoader: async () => undefined }).record(
      settledEvent({
        runId: "run-invalid-usage",
        tokenUsage: {
          promptTokens: Number.MAX_SAFE_INTEGER + 1,
          completionTokens: 0,
          totalTokens: Number.MAX_SAFE_INTEGER + 1,
        },
      }),
    );
    expect(result).toBeUndefined();
    expect(await store.read("book-alpha")).toEqual([]);
    expect(await store.readFailureMarker("book-alpha")).toMatchObject({
      failureCount: 1,
      lastErrorCode: "LEDGER_INVALID_SCHEMA",
      missedRunIds: ["run-invalid-usage"],
    });
  });

  it("fails open while logging and persisting a write-failure marker", async () => {
    const marker: CostLedgerFailureMarkerV1 = {
      schemaVersion: 1,
      failureCount: 1,
      lastErrorCode: "LEDGER_WRITE_FAILED",
      lastFailedAt: "2026-07-17T00:00:00.000Z",
      missedRunIds: ["run-1"],
    };
    const failingStore = {
      append: vi.fn(async () => {
        throw new CostLedgerError("LEDGER_WRITE_FAILED", "book-alpha", "disk full");
      }),
      recordWriteFailure: vi.fn(async () => marker),
    };
    const target = new CostLedgerRecorder({
      projectRoot,
      pipelineConfig: { model: "main-model" },
      store: failingStore,
      priceTableLoader: async () => undefined,
      inkosVersionLoader: async () => "1.7.0",
      logger,
    });

    await expect(target.record(settledEvent())).resolves.toBeUndefined();
    expect(failingStore.recordWriteFailure).toHaveBeenCalledWith("book-alpha", {
      errorCode: "LEDGER_WRITE_FAILED",
      runId: "run-1",
    });
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs an error when the failure marker cannot be persisted", async () => {
    const target = new CostLedgerRecorder({
      projectRoot,
      pipelineConfig: { model: "main-model" },
      store: {
        append: vi.fn(async () => { throw new Error("disk unavailable"); }),
        recordWriteFailure: vi.fn(async () => undefined),
      },
      priceTableLoader: async () => undefined,
      inkosVersionLoader: async () => "1.7.0",
      logger,
    });
    await expect(target.record(settledEvent())).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("failure marker"),
      expect.objectContaining({ runId: "run-1" }),
    );
  });

  it("is exported from the core package root", async () => {
    const core = await import("../index.js");
    expect(core.CostLedgerRecorder).toBe(CostLedgerRecorder);
  });

  it("provides a handler directly assignable to the orchestrator event container", () => {
    const target = recorder({ priceTableLoader: async () => undefined });
    const events: VolumeProductionEvents = { onProductionSettled: target.onProductionSettled };
    expect(events.onProductionSettled).toBe(target.onProductionSettled);
  });
});
