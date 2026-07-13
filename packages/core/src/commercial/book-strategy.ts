import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { BookWriteLockError, StateManager } from "../state/manager.js";
import { assertSafeBookId, isSafeBookId } from "../utils/book-id.js";
import { safeChildPath } from "../utils/path-safety.js";

export const PRODUCTION_MODES = ["volume", "flagship"] as const;
export const BOOK_STRATEGY_SCHEMA_VERSION = 1 as const;
export const BOOK_STRATEGY_RELATIVE_PATH = "commercial/book-strategy.json";

export const ProductionModeSchema = z.enum(PRODUCTION_MODES);
export type ProductionMode = z.infer<typeof ProductionModeSchema>;

const SafeBookIdSchema = z.string().refine(isSafeBookId, "Invalid bookId");

export const BookStrategySchema = z.object({
  schemaVersion: z.literal(BOOK_STRATEGY_SCHEMA_VERSION),
  bookId: SafeBookIdSchema,
  productionMode: ProductionModeSchema,
  updatedAt: z.string().datetime(),
}).strict();

export type BookStrategy = z.infer<typeof BookStrategySchema>;

const BookStrategyInputSchema = z.object({
  bookId: SafeBookIdSchema,
  productionMode: ProductionModeSchema,
}).strict();

export type BookStrategyInput = z.infer<typeof BookStrategyInputSchema>;

export type ResolvedBookStrategy =
  | {
      readonly schemaVersion: 1;
      readonly bookId: string;
      readonly productionMode: "volume";
      readonly source: "default";
    }
  | (BookStrategy & {
      readonly source: "file";
    });

export const BOOK_STRATEGY_ERROR_CODES = [
  "BOOK_STRATEGY_INVALID_PATH",
  "BOOK_STRATEGY_INVALID_JSON",
  "BOOK_STRATEGY_INVALID_SCHEMA",
  "BOOK_STRATEGY_UNSUPPORTED_VERSION",
  "BOOK_STRATEGY_BOOK_ID_MISMATCH",
  "BOOK_STRATEGY_READ_FAILED",
  "BOOK_STRATEGY_WRITE_FAILED",
] as const;

export type BookStrategyErrorCode = (typeof BOOK_STRATEGY_ERROR_CODES)[number];

export class BookStrategyError extends Error {
  readonly relativePath = BOOK_STRATEGY_RELATIVE_PATH;

  constructor(
    readonly code: BookStrategyErrorCode,
    readonly bookId: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "BookStrategyError";
  }
}

export interface BookStrategyStoreOptions {
  readonly now?: () => Date;
  readonly atomicReplace?: (sourcePath: string, destinationPath: string) => Promise<void>;
}

interface ResolvedStrategyPaths {
  readonly bookId: string;
  readonly bookRoot: string;
  readonly strategyPath: string;
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

export class BookStrategyStore {
  private readonly now: () => Date;
  private readonly atomicReplace: (sourcePath: string, destinationPath: string) => Promise<void>;

  constructor(
    private readonly projectRoot: string,
    options: BookStrategyStoreOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.atomicReplace = options.atomicReplace ?? rename;
  }

  resolvePath(bookId: string): string {
    return this.resolvePaths(bookId).strategyPath;
  }

  async load(bookId: string): Promise<ResolvedBookStrategy> {
    const paths = this.resolvePaths(bookId);
    let raw: string;

    try {
      raw = await readFile(paths.strategyPath, "utf-8");
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") {
        return {
          schemaVersion: BOOK_STRATEGY_SCHEMA_VERSION,
          bookId: paths.bookId,
          productionMode: "volume",
          source: "default",
        };
      }
      throw new BookStrategyError(
        "BOOK_STRATEGY_READ_FAILED",
        paths.bookId,
        "Failed to read " + BOOK_STRATEGY_RELATIVE_PATH + " for book " + JSON.stringify(paths.bookId),
        error,
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch (error) {
      throw new BookStrategyError(
        "BOOK_STRATEGY_INVALID_JSON",
        paths.bookId,
        "Invalid JSON in " + BOOK_STRATEGY_RELATIVE_PATH + " for book " + JSON.stringify(paths.bookId),
        error,
      );
    }

    if (
      isRecord(parsedJson)
      && typeof parsedJson.schemaVersion === "number"
      && parsedJson.schemaVersion !== BOOK_STRATEGY_SCHEMA_VERSION
    ) {
      throw new BookStrategyError(
        "BOOK_STRATEGY_UNSUPPORTED_VERSION",
        paths.bookId,
        "Unsupported book strategy schemaVersion "
          + String(parsedJson.schemaVersion)
          + " for book "
          + JSON.stringify(paths.bookId),
      );
    }

    const result = BookStrategySchema.safeParse(parsedJson);
    if (!result.success) {
      throw new BookStrategyError(
        "BOOK_STRATEGY_INVALID_SCHEMA",
        paths.bookId,
        "Invalid book strategy schema for book "
          + JSON.stringify(paths.bookId)
          + ": "
          + formatSchemaIssues(result.error),
        result.error,
      );
    }

    if (result.data.bookId !== paths.bookId) {
      throw new BookStrategyError(
        "BOOK_STRATEGY_BOOK_ID_MISMATCH",
        paths.bookId,
        "Book strategy bookId "
          + JSON.stringify(result.data.bookId)
          + " does not match expected bookId "
          + JSON.stringify(paths.bookId),
      );
    }

    return { ...result.data, source: "file" };
  }

  async save(bookId: string, input: BookStrategyInput): Promise<BookStrategy> {
    const paths = this.resolvePaths(bookId);
    const parsedInput = BookStrategyInputSchema.safeParse(input);

    if (!parsedInput.success) {
      throw new BookStrategyError(
        "BOOK_STRATEGY_INVALID_SCHEMA",
        paths.bookId,
        "Invalid book strategy input for book "
          + JSON.stringify(paths.bookId)
          + ": "
          + formatSchemaIssues(parsedInput.error),
        parsedInput.error,
      );
    }

    if (parsedInput.data.bookId !== paths.bookId) {
      throw new BookStrategyError(
        "BOOK_STRATEGY_BOOK_ID_MISMATCH",
        paths.bookId,
        "Book strategy input bookId "
          + JSON.stringify(parsedInput.data.bookId)
          + " does not match expected bookId "
          + JSON.stringify(paths.bookId),
      );
    }

    let releaseLock: (() => Promise<void>) | undefined;
    try {
      releaseLock = await new StateManager(this.projectRoot).acquireBookLock(paths.bookId);
    } catch (error) {
      if (error instanceof BookWriteLockError) throw error;
      throw new BookStrategyError(
        "BOOK_STRATEGY_WRITE_FAILED",
        paths.bookId,
        "Failed to acquire the write lock for book " + JSON.stringify(paths.bookId),
        error,
      );
    }

    try {
      await this.load(paths.bookId);
      const strategy = BookStrategySchema.parse({
        schemaVersion: BOOK_STRATEGY_SCHEMA_VERSION,
        bookId: paths.bookId,
        productionMode: parsedInput.data.productionMode,
        updatedAt: this.now().toISOString(),
      });
      await this.writeAtomically(paths, strategy);
      return strategy;
    } catch (error) {
      if (error instanceof BookStrategyError || error instanceof BookWriteLockError) {
        throw error;
      }
      throw new BookStrategyError(
        "BOOK_STRATEGY_WRITE_FAILED",
        paths.bookId,
        "Failed to save " + BOOK_STRATEGY_RELATIVE_PATH + " for book " + JSON.stringify(paths.bookId),
        error,
      );
    } finally {
      await releaseLock();
    }
  }

  async setProductionMode(bookId: string, productionMode: ProductionMode): Promise<BookStrategy> {
    return this.save(bookId, { bookId, productionMode });
  }

  private resolvePaths(bookId: string): ResolvedStrategyPaths {
    try {
      const safeBookId = assertSafeBookId(bookId, "bookStrategy.bookId");
      const booksRoot = safeChildPath(this.projectRoot, "books");
      const bookRoot = safeChildPath(booksRoot, safeBookId);
      return {
        bookId: safeBookId,
        bookRoot,
        strategyPath: safeChildPath(bookRoot, BOOK_STRATEGY_RELATIVE_PATH),
      };
    } catch (error) {
      throw new BookStrategyError(
        "BOOK_STRATEGY_INVALID_PATH",
        typeof bookId === "string" ? bookId : String(bookId),
        "Invalid book strategy path for bookId " + JSON.stringify(bookId),
        error,
      );
    }
  }

  private async writeAtomically(
    paths: ResolvedStrategyPaths,
    strategy: BookStrategy,
  ): Promise<void> {
    const directory = dirname(paths.strategyPath);
    const temporaryPath = safeChildPath(
      directory,
      ".book-strategy."
        + process.pid
        + "."
        + randomUUID()
        + ".tmp",
    );
    let handle: Awaited<ReturnType<typeof open>> | undefined;

    try {
      await mkdir(directory, { recursive: true });
      handle = await open(temporaryPath, "wx");
      await handle.writeFile(JSON.stringify(strategy, null, 2) + "\n", "utf-8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.atomicReplace(temporaryPath, paths.strategyPath);
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw new BookStrategyError(
        "BOOK_STRATEGY_WRITE_FAILED",
        paths.bookId,
        "Failed to atomically write "
          + BOOK_STRATEGY_RELATIVE_PATH
          + " for book "
          + JSON.stringify(paths.bookId),
        error,
      );
    }
  }
}
