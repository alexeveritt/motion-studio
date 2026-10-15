import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { MotionStudioError } from "./errors.ts";
import { parseRecord, type RecordKind } from "./schemas/parse.ts";

/**
 * Write a file atomically: write a sibling temporary file, flush it to disk,
 * then rename over the target. Readers never observe a partial file.
 */
export async function writeFileAtomic(target: string, data: string | Uint8Array): Promise<void> {
  const dir = path.dirname(target);
  const temp = path.join(dir, `.${path.basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
  const handle = await open(temp, "wx", 0o644);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle.close();
    await rm(temp, { force: true });
    throw error;
  }
  await handle.close();
  try {
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await writeFileAtomic(target, serializeJson(value));
}

/** Create a new file, failing if it already exists. */
export async function writeFileExclusive(target: string, data: string): Promise<void> {
  const handle = await open(target, "wx", 0o644);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Create a directory, failing with ALREADY_EXISTS if it is present. Used to
 * claim a slug atomically so two creates can never share a folder.
 */
export async function createDirectoryExclusive(target: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    await mkdir(target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new MotionStudioError("ALREADY_EXISTS", "A folder with that name already exists");
    }
    throw error;
  }
}

export async function readJsonRecord<T extends z.ZodType>(
  file: string,
  schema: T,
  kind: RecordKind,
): Promise<z.infer<T>> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new MotionStudioError("NOT_FOUND", `The ${kind} record no longer exists`);
    }
    throw new MotionStudioError("READ_FAILED", `The ${kind} record could not be read`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new MotionStudioError("JSON_INVALID", `The ${kind} record is not valid JSON`);
  }
  return parseRecord(schema, data, kind);
}

/**
 * Serialise async work per key within this process. The studio is the only
 * writer, so this prevents read-check-write races between concurrent requests.
 */
export class KeyedMutex {
  readonly #tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    const result = previous.then(task, task);
    const tail = result.catch(() => undefined);
    this.#tails.set(key, tail);
    try {
      return await result;
    } finally {
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}
