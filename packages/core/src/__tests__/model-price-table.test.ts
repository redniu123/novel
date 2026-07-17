import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MODEL_PRICE_TABLE_RELATIVE_PATH,
  ModelPriceTableError,
  addDecimalStrings,
  computeCost,
  loadModelPriceTable,
} from "../commercial/model-price-table.js";

describe("model price table", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-price-table-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  async function writeTable(content: string): Promise<void> {
    const path = join(projectRoot, MODEL_PRICE_TABLE_RELATIVE_PATH);
    await mkdir(join(projectRoot, "config"), { recursive: true });
    await writeFile(path, content, "utf-8");
  }

  describe("loading", () => {
    it("returns undefined when the file is missing (distinct from invalid)", async () => {
      expect(await loadModelPriceTable(projectRoot)).toBeUndefined();
    });

    it("loads and validates a correct table", async () => {
      await writeTable(
        JSON.stringify({
          schemaVersion: 1,
          version: "2026-07-17",
          currency: "CNY",
          models: { "test-model": { promptPerMTokens: "2.5", completionPerMTokens: "9.8" } },
        }),
      );
      const table = await loadModelPriceTable(projectRoot);
      expect(table?.models["test-model"]?.promptPerMTokens).toBe("2.5");
    });

    it("throws PRICE_TABLE_INVALID on broken JSON", async () => {
      await writeTable("{broken");
      await expect(loadModelPriceTable(projectRoot)).rejects.toBeInstanceOf(ModelPriceTableError);
    });

    it("throws PRICE_TABLE_INVALID on schema violations, including float prices and negatives", async () => {
      await writeTable(
        JSON.stringify({
          schemaVersion: 1,
          version: "v",
          currency: "CNY",
          models: { m: { promptPerMTokens: 2.5, completionPerMTokens: "9.8" } },
        }),
      );
      await expect(loadModelPriceTable(projectRoot)).rejects.toBeInstanceOf(ModelPriceTableError);

      await writeTable(
        JSON.stringify({
          schemaVersion: 1,
          version: "v",
          currency: "CNY",
          models: { m: { promptPerMTokens: "-1", completionPerMTokens: "9.8" } },
        }),
      );
      await expect(loadModelPriceTable(projectRoot)).rejects.toBeInstanceOf(ModelPriceTableError);
    });

    it("rejects unsupported schema versions", async () => {
      await writeTable(JSON.stringify({ schemaVersion: 2, version: "v", currency: "CNY", models: {} }));
      await expect(loadModelPriceTable(projectRoot)).rejects.toBeInstanceOf(ModelPriceTableError);
    });
  });

  describe("cost math", () => {
    const price = { promptPerMTokens: "2.5", completionPerMTokens: "9.8" };

    it("computes the chapter-1 reference numbers exactly", () => {
      const cost = computeCost({
        promptTokens: 67_637,
        completionTokens: 162_749,
        price,
        currency: "CNY",
        priceTableVersion: "2026-07-17",
        approximate: false,
      });
      expect(cost.promptCost).toBe("0.1690925");
      expect(cost.completionCost).toBe("1.5949402");
      expect(cost.totalCost).toBe("1.7640327");
      expect(cost.unitPriceSnapshot).toEqual(price);
      expect(cost.approximate).toBe(false);
    });

    it("is exact for adversarially large token counts", () => {
      const cost = computeCost({
        promptTokens: Number.MAX_SAFE_INTEGER,
        completionTokens: 0,
        price: { promptPerMTokens: "0.000001", completionPerMTokens: "1" },
        currency: "CNY",
        priceTableVersion: "v",
        approximate: true,
      });
      // 9007199254740991 tokens x 0.000001 per 1M tokens = 9007199254740991e-12 exactly:
      expect(cost.promptCost).toBe("9007.199254740991");
      expect(cost.totalCost).toBe("9007.199254740991");
      expect(cost.approximate).toBe(true);
    });

    it("produces zero-cost strings without floating point artifacts", () => {
      const cost = computeCost({
        promptTokens: 0,
        completionTokens: 0,
        price,
        currency: "CNY",
        priceTableVersion: "v",
        approximate: false,
      });
      expect(cost.promptCost).toBe("0");
      expect(cost.totalCost).toBe("0");
    });

    it("rejects negative, fractional, and unsafe token counts", () => {
      for (const bad of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() =>
          computeCost({
            promptTokens: bad,
            completionTokens: 0,
            price,
            currency: "CNY",
            priceTableVersion: "v",
            approximate: false,
          }),
        ).toThrow(TypeError);
      }
    });

    it("adds decimal strings with scale alignment and no drift", () => {
      expect(addDecimalStrings("0.1", "0.02")).toBe("0.12");
      expect(addDecimalStrings("0", "0")).toBe("0");
      expect(addDecimalStrings("999999999999999999.999999", "0.000001")).toBe("1000000000000000000");
      let total = "0";
      for (let index = 0; index < 10; index++) total = addDecimalStrings(total, "0.1");
      expect(total).toBe("1"); // the classic 0.1*10 float trap
    });
  });
});
