import { stat } from "node:fs/promises";
import { goldenImageFile, MotionStudioError } from "@motion-studio/core";
import type { APIRoute } from "astro";
import { errorResponse, param } from "../../../../../lib/server/http.ts";
import { serveFileWithRange } from "../../../../../lib/server/serve-file.ts";
import { getWorkspace } from "../../../../../lib/server/studio.ts";

const KINDS = ["baseline", "actual", "diff"] as const;

/**
 * Serve a golden image: `?kind=baseline&frame=N`, or
 * `?kind=actual|diff&frame=N&renderId=…` for a frame from a compared job.
 */
export const GET: APIRoute = async (context) => {
  try {
    const query = context.url.searchParams;
    const kind = KINDS.find((candidate) => candidate === query.get("kind"));
    const frame = Number(query.get("frame"));
    if (!kind) throw new MotionStudioError("NOT_FOUND", "No such image");
    const file = await goldenImageFile(
      await getWorkspace(),
      param(context, "id"),
      kind,
      frame,
      query.get("renderId") ?? undefined,
    );
    await stat(file).catch(() => {
      throw new MotionStudioError("NOT_FOUND", "No such image");
    });
    return await serveFileWithRange(context.request, file, "image/png", `frame-${frame}.png`);
  } catch (error) {
    return errorResponse(error);
  }
};
