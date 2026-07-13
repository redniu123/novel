import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BookStrategyError,
  BookStrategySchema,
  BookStrategyStore,
  ProductionModeSchema,
  type BookStrategyErrorCode,
  type ProductionMode,
} from "../commercial/book-strategy.js";

describe("BookStrategyStore", () => {
  let projectRoot: string;
  let store: BookStrategyStore;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "inkos-book-strategy-"));
    store = new BookStrategyStore(projectRoot);
  });

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true });
  });

  function strategyPath(bookId: string): string {
    return join(projectRoot, "books", bookId, "commercial", "book-strategy.json");
  }

  async function writeStrategyFile(bookId: string, value: unknown): Promise<void> {
    const path = strategyPath(bookId);
    await mkdir(dirname(path), { recursive: true });
    const content = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    await writeFile(path, content, "utf-8");
  }

  async function expectStrategyError(
    promise: Promise<unknown>,
    code: BookStrategyErrorCode,
  ): Promise<void> {
    await expect(promise).rejects.toMatchObject({
      name: "BookStrategyError",
      code,
    });
  }

  it("returns volume from a missing strategy without inventing updatedAt", async () => {
    await expect(store.load("legacy-book")).resolves.toEqual({
      schemaVersion: 1,
      bookId: "legacy-book",
      productionMode: "volume",
      source: "default",
    });

    const resolved = await store.load("legacy-book");
    expect("updatedAt" in resolved).toBe(false);
  });

  it("does not create directories or files during a default read", async () => {
    await store.load("no-write-book");

    await expect(access(join(projectRoot, "books"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("saves and reloads volume", async () => {
    const saved = await store.setProductionMode("volume-book", "volume");
    const loaded = await store.load("volume-book");

    expect(saved.productionMode).toBe("volume");
    expect(loaded).toEqual({ ...saved, source: "file" });
  });

  it("saves and reloads flagship", async () => {
    const saved = await store.setProductionMode("flagship-book", "flagship");

    await expect(store.load("flagship-book")).resolves.toEqual({
      ...saved,
      source: "file",
    });
  });

  it("rejects an invalid production mode without creating a strategy", async () => {
    expect(ProductionModeSchema.safeParse("premium").success).toBe(false);

    await expectStrategyError(
      store.setProductionMode("invalid-mode", "premium" as ProductionMode),
      "BOOK_STRATEGY_INVALID_SCHEMA",
    );
    await expect(access(strategyPath("invalid-mode"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("rejects damaged JSON and does not overwrite it", async () => {
    const raw = "{ damaged json";
    await writeStrategyFile("damaged-book", raw);

    await expectStrategyError(
      store.load("damaged-book"),
      "BOOK_STRATEGY_INVALID_JSON",
    );
    await expectStrategyError(
      store.setProductionMode("damaged-book", "flagship"),
      "BOOK_STRATEGY_INVALID_JSON",
    );
    await expect(readFile(strategyPath("damaged-book"), "utf-8")).resolves.toBe(raw);
  });

  it("rejects missing required fields", async () => {
    await writeStrategyFile("missing-fields", {
      schemaVersion: 1,
      bookId: "missing-fields",
    });

    await expectStrategyError(
      store.load("missing-fields"),
      "BOOK_STRATEGY_INVALID_SCHEMA",
    );
  });

  it("rejects unsupported schema versions distinctly", async () => {
    await writeStrategyFile("future-version", {
      schemaVersion: 2,
      bookId: "future-version",
      productionMode: "volume",
      updatedAt: "2026-07-13T00:00:00.000Z",
    });

    await expectStrategyError(
      store.load("future-version"),
      "BOOK_STRATEGY_UNSUPPORTED_VERSION",
    );
  });

  it("rejects persisted and input bookId mismatches", async () => {
    await writeStrategyFile("book-a", {
      schemaVersion: 1,
      bookId: "book-b",
      productionMode: "volume",
      updatedAt: "2026-07-13T00:00:00.000Z",
    });

    await expectStrategyError(
      store.load("book-a"),
      "BOOK_STRATEGY_BOOK_ID_MISMATCH",
    );
    await expectStrategyError(
      store.save("book-c", { bookId: "book-d", productionMode: "flagship" }),
      "BOOK_STRATEGY_BOOK_ID_MISMATCH",
    );
  });

  it("keeps two books isolated", async () => {
    await store.setProductionMode("book-volume", "volume");
    await store.setProductionMode("book-flagship", "flagship");

    const [volume, flagship] = await Promise.all([
      store.load("book-volume"),
      store.load("book-flagship"),
    ]);
    expect(volume.productionMode).toBe("volume");
    expect(flagship.productionMode).toBe("flagship");
    expect(strategyPath("book-volume")).not.toBe(strategyPath("book-flagship"));
  });

  it("uses UTC ISO updatedAt and refreshes it on update", async () => {
    let current = new Date("2026-07-13T01:02:03.456Z");
    const clockedStore = new BookStrategyStore(projectRoot, {
      now: () => current,
    });

    const first = await clockedStore.setProductionMode("clock-book", "volume");
    expect(first.updatedAt).toBe("2026-07-13T01:02:03.456Z");
    expect(BookStrategySchema.safeParse(first).success).toBe(true);

    current = new Date("2026-07-13T02:03:04.567Z");
    const second = await clockedStore.setProductionMode("clock-book", "flagship");
    expect(second.updatedAt).toBe("2026-07-13T02:03:04.567Z");
  });

  it("preserves the old file and cleans the temp file when atomic replace fails", async () => {
    await store.setProductionMode("atomic-book", "volume");
    const before = await readFile(strategyPath("atomic-book"), "utf-8");
    const failingStore = new BookStrategyStore(projectRoot, {
      atomicReplace: async () => {
        throw Object.assign(new Error("rename failed"), { code: "EACCES" });
      },
    });

    await expectStrategyError(
      failingStore.setProductionMode("atomic-book", "flagship"),
      "BOOK_STRATEGY_WRITE_FAILED",
    );

    expect(await readFile(strategyPath("atomic-book"), "utf-8")).toBe(before);
    expect(await store.load("atomic-book")).toMatchObject({
      productionMode: "volume",
      source: "file",
    });
    const entries = await readdir(dirname(strategyPath("atomic-book")));
    expect(entries.filter((entry) => entry.endsWith(".tmp"))).toEqual([]);
  });

  it("rejects path traversal before touching the filesystem", async () => {
    expect(() => store.resolvePath("../outside")).toThrowError(BookStrategyError);
    await expectStrategyError(
      store.load("../outside"),
      "BOOK_STRATEGY_INVALID_PATH",
    );
    await expect(access(join(projectRoot, "outside"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("does not modify story/state", async () => {
    const statePath = join(
      projectRoot,
      "books",
      "state-book",
      "story",
      "state",
      "manifest.json",
    );
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, "{\"chapter\":7}\n", "utf-8");
    const before = await readFile(statePath, "utf-8");

    await store.setProductionMode("state-book", "flagship");

    expect(await readFile(statePath, "utf-8")).toBe(before);
    expect(await readdir(dirname(statePath))).toEqual(["manifest.json"]);
  });

  it("does not create or modify story/memory.db", async () => {
    const memoryPath = join(
      projectRoot,
      "books",
      "memory-book",
      "story",
      "memory.db",
    );
    await mkdir(dirname(memoryPath), { recursive: true });
    const before = Buffer.from([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65]);
    await writeFile(memoryPath, before);

    await store.setProductionMode("memory-book", "volume");

    expect(await readFile(memoryPath)).toEqual(before);
  });

  it("keeps an old book compatible without creating commercial metadata", async () => {
    const bookRoot = join(projectRoot, "books", "old-book");
    const bookConfigPath = join(bookRoot, "book.json");
    const storyPath = join(bookRoot, "story", "current_state.md");
    await mkdir(dirname(storyPath), { recursive: true });
    await writeFile(bookConfigPath, "{\"id\":\"old-book\"}\n", "utf-8");
    await writeFile(storyPath, "# Existing state\n", "utf-8");

    const result = await store.load("old-book");

    expect(result).toMatchObject({
      productionMode: "volume",
      source: "default",
    });
    expect(await readFile(bookConfigPath, "utf-8")).toBe("{\"id\":\"old-book\"}\n");
    expect(await readFile(storyPath, "utf-8")).toBe("# Existing state\n");
    await expect(access(join(bookRoot, "commercial"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
