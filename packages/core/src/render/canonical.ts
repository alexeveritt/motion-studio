import { createHash } from "node:crypto";

/** JSON with object keys sorted at every level, so equal values always serialise identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
