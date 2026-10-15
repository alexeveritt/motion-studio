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

/**
 * Stream a file with HTTP Range support so <video> can seek. Only byte
 * ranges of the form "bytes=start-end" are honoured.
 */
export async function serveFileWithRange(
  request: Request,
  file: string,
  mimeType: string,
  fileName: string,
): Promise<Response> {
  const { size } = await stat(file);
  const headers = new Headers({
    "Content-Type": mimeType,
    "Accept-Ranges": "bytes",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("range") ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers,
    });
  }
  headers.set("Content-Length", String(size));
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers });
}
