import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { AssetRecord } from "@motion-studio/core";

const INLINE = /^(image|audio|video|font)\//;

/**
 * Stream a registered asset. The MIME type was detected from the bytes at
 * upload; SVGs get a sandboxing policy so they can never run script.
 */
export async function serveAsset(file: string, record: AssetRecord): Promise<Response> {
  const { size } = await stat(file);
  const headers = new Headers({
    "Content-Type": record.mimeType,
    "Content-Length": String(size),
    "Content-Disposition": `${INLINE.test(record.mimeType) ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(record.storedName)}`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (record.mimeType === "image/svg+xml") {
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers });
}
