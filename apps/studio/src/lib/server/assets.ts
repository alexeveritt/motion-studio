import { assetScope, MotionStudioError, type AssetScope } from "@motion-studio/core";
import type { APIContext } from "astro";
import { param } from "./http.ts";

export function assetTarget(context: APIContext): [AssetScope, string] {
  const parsed = assetScope.safeParse(param(context, "scope"));
  if (!parsed.success) throw new MotionStudioError("NOT_FOUND", "Unknown asset scope");
  return [parsed.data, param(context, "id")];
}

/** Iterate a request body stream chunk by chunk. */
export async function* streamChunks(body: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
