import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createDirectoryExclusive,
  KeyedMutex,
  writeFileAtomic,
  writeFileExclusive,
} from "../src/fs-store.ts";

const tempDir = () => mkdtemp(path.join(tmpdir(), "motion-studio-fs-"));

describe("writeFileAtomic", () => {
  it("replaces content and leaves no temporary files", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "record.json");
    await writeFile(file, "old");
    await writeFileAtomic(file, "new");
    expect(await readFile(file, "utf8")).toBe("new");
    expect(await readdir(dir)).toEqual(["record.json"]);
  });

  it("never exposes a partially written file to concurrent writers", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "doc.md");
    const contents = Array.from({ length: 20 }, (_, i) => String(i).repeat(50_000));
    await Promise.all(contents.map((content) => writeFileAtomic(file, content)));
    expect(contents).toContain(await readFile(file, "utf8"));
    expect(await readdir(dir)).toEqual(["doc.md"]);
  });

  it("fails cleanly when the folder does not exist", async () => {
    const dir = await tempDir();
    await expect(writeFileAtomic(path.join(dir, "missing/file.md"), "x")).rejects.toThrow();
  });
});

describe("exclusive creation", () => {
  it("refuses to overwrite an existing file", async () => {
    const dir = await tempDir();
    const file = path.join(dir, "a.md");
    await writeFileExclusive(file, "first");
    await expect(writeFileExclusive(file, "second")).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(file, "utf8")).toBe("first");
  });

  it("claims a directory exactly once", async () => {
    const dir = await tempDir();
    const target = path.join(dir, "cookguide");
    const results = await Promise.allSettled([1, 2, 3].map(() => createDirectoryExclusive(target)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      results
        .filter((r) => r.status === "rejected")
        .map((r) => (r as PromiseRejectedResult).reason.code),
    ).toEqual(["ALREADY_EXISTS", "ALREADY_EXISTS"]);
  });
});

describe("KeyedMutex", () => {
  it("runs tasks for the same key one at a time, in order, even after failures", async () => {
    const mutex = new KeyedMutex();
    const events: string[] = [];
    const task =
      (name: string, fail = false) =>
      async () => {
        events.push(`start ${name}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        events.push(`end ${name}`);
        if (fail) throw new Error(name);
        return name;
      };
    const results = await Promise.allSettled([
      mutex.run("k", task("a")),
      mutex.run("k", task("b", true)),
      mutex.run("k", task("c")),
    ]);
    expect(events).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });
});
