import { readFile } from "node:fs/promises";
import { z } from "zod";
import { safeChildPath } from "../utils/path-safety.js";

/**
 * TASK-004A: project-level model price table.
 *
 * Loaded from `<projectRoot>/config/model-prices.json`, maintained by the user.
 * The real file is gitignored (frozen parameter P8); the repository only ships
 * `config/model-prices.example.json` as a template. Prices are plain decimal
 * strings (per 1M tokens) to keep binary floating point out of money math.
 */
export const MODEL_PRICE_TABLE_SCHEMA_VERSION = 1 as const;
export const MODEL_PRICE_TABLE_RELATIVE_PATH = "config/model-prices.json";

const DECIMAL_PATTERN = /^\d+(\.\d+)?$/;
const DecimalStringSchema = z
  .string()
  .regex(DECIMAL_PATTERN, "expected a non-negative decimal string like \"12\" or \"0.35\"");

export const ModelPriceSchema = z
  .object({
    promptPerMTokens: DecimalStringSchema,
    completionPerMTokens: DecimalStringSchema,
  })
  .strict();
export type ModelPriceV1 = z.infer<typeof ModelPriceSchema>;

export const ModelPriceTableSchema = z
  .object({
    schemaVersion: z.literal(MODEL_PRICE_TABLE_SCHEMA_VERSION),
    version: z.string().min(1),
    currency: z.string().min(1),
    models: z.record(z.string().min(1), ModelPriceSchema),
  })
  .strict();
export type ModelPriceTableV1 = z.infer<typeof ModelPriceTableSchema>;

export class ModelPriceTableError extends Error {
  readonly code = "PRICE_TABLE_INVALID" as const;
  readonly relativePath = MODEL_PRICE_TABLE_RELATIVE_PATH;

  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ModelPriceTableError";
  }
}

/**
 * Loads and validates the project price table.
 *
 * - Missing file: returns `undefined` (ledger entries record
 *   `costUnavailableReason: "price_table_missing"`).
 * - Unreadable, unparseable, or schema-invalid file: throws
 *   {@link ModelPriceTableError} (`PRICE_TABLE_INVALID`). Callers must map
 *   this to `costUnavailableReason: "price_table_invalid"` instead of
 *   treating it like a missing model price (red-team finding D3).
 */
export async function loadModelPriceTable(projectRoot: string): Promise<ModelPriceTableV1 | undefined> {
  let path: string;
  try {
    path = safeChildPath(projectRoot, MODEL_PRICE_TABLE_RELATIVE_PATH);
  } catch (error) {
    throw new ModelPriceTableError("Invalid model price table path", { cause: error });
  }

  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") return undefined;
    throw new ModelPriceTableError("Failed to read " + MODEL_PRICE_TABLE_RELATIVE_PATH, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new ModelPriceTableError(MODEL_PRICE_TABLE_RELATIVE_PATH + " is not valid JSON", { cause: error });
  }

  const result = ModelPriceTableSchema.safeParse(parsed);
  if (!result.success) {
    throw new ModelPriceTableError(MODEL_PRICE_TABLE_RELATIVE_PATH + " failed schema validation", {
      cause: result.error,
    });
  }
  return result.data;
}

// === Exact decimal money math (BigInt-backed; no binary floats) ===

interface ScaledDecimal {
  readonly units: bigint;
  readonly scale: number;
}

function parseDecimal(value: string): ScaledDecimal {
  if (!DECIMAL_PATTERN.test(value)) {
    throw new TypeError("Invalid decimal string: " + JSON.stringify(value));
  }
  const [integerPart, fractionPart = ""] = value.split(".");
  return { units: BigInt(integerPart + fractionPart), scale: fractionPart.length };
}

function formatDecimal(value: ScaledDecimal): string {
  const digits = value.units.toString().padStart(value.scale + 1, "0");
  const integerPart = value.scale === 0 ? digits : digits.slice(0, -value.scale);
  const fractionPart = value.scale === 0 ? "" : digits.slice(-value.scale).replace(/0+$/, "");
  return fractionPart.length > 0 ? integerPart + "." + fractionPart : integerPart;
}

function alignAndAdd(a: ScaledDecimal, b: ScaledDecimal): ScaledDecimal {
  const scale = Math.max(a.scale, b.scale);
  const aUnits = a.units * 10n ** BigInt(scale - a.scale);
  const bUnits = b.units * 10n ** BigInt(scale - b.scale);
  return { units: aUnits + bUnits, scale };
}

const TOKENS_PER_PRICE_UNIT_SCALE = 6; // prices are per 1,000,000 tokens

function assertTokenCount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(field + " must be a non-negative safe integer, got " + String(value));
  }
}

export interface ComputedCost {
  readonly currency: string;
  readonly promptCost: string;
  readonly completionCost: string;
  readonly totalCost: string;
  readonly priceTableVersion: string;
  readonly unitPriceSnapshot: {
    readonly promptPerMTokens: string;
    readonly completionPerMTokens: string;
  };
  readonly approximate: boolean;
}

/**
 * Computes exact decimal cost for one ledger entry.
 * `cost = tokens x pricePerMTokens / 1e6`, carried out in BigInt so that
 * adversarially large token counts cannot introduce floating point error.
 */
export function computeCost(input: {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly price: ModelPriceV1;
  readonly currency: string;
  readonly priceTableVersion: string;
  readonly approximate: boolean;
}): ComputedCost {
  assertTokenCount(input.promptTokens, "promptTokens");
  assertTokenCount(input.completionTokens, "completionTokens");

  const promptPrice = parseDecimal(input.price.promptPerMTokens);
  const completionPrice = parseDecimal(input.price.completionPerMTokens);
  const promptCost: ScaledDecimal = {
    units: BigInt(input.promptTokens) * promptPrice.units,
    scale: promptPrice.scale + TOKENS_PER_PRICE_UNIT_SCALE,
  };
  const completionCost: ScaledDecimal = {
    units: BigInt(input.completionTokens) * completionPrice.units,
    scale: completionPrice.scale + TOKENS_PER_PRICE_UNIT_SCALE,
  };

  return {
    currency: input.currency,
    promptCost: formatDecimal(promptCost),
    completionCost: formatDecimal(completionCost),
    totalCost: formatDecimal(alignAndAdd(promptCost, completionCost)),
    priceTableVersion: input.priceTableVersion,
    unitPriceSnapshot: {
      promptPerMTokens: input.price.promptPerMTokens,
      completionPerMTokens: input.price.completionPerMTokens,
    },
    approximate: input.approximate,
  };
}

/** Exact decimal-string addition for aggregation (both inputs validated). */
export function addDecimalStrings(a: string, b: string): string {
  return formatDecimal(alignAndAdd(parseDecimal(a), parseDecimal(b)));
}
