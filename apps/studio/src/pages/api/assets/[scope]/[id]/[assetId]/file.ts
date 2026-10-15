import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { APIRoute } from "astro";
import { assetTarget } from "../../../../../../lib/server/assets.ts";
import { errorResponse, param } from "../../../../../../lib/server/http.ts";
import { getAssets } from "../../../../../../lib/server/studio.ts";

const INLINE = /^(image|audio|video)\//;

/**
 * Serve an asset by opaque ID. The stored MIME type was detected from the
 * bytes at upload; SVGs get a sandboxing policy so they can never run script.
 */
export const GET: APIRoute = async (context) => {
  try {
    const { file, record } = await (
      await getAssets()
    ).open(...assetTarget(context), param(context, "assetId"));
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
  } catch (error) {
    return errorResponse(error);
  }
};
