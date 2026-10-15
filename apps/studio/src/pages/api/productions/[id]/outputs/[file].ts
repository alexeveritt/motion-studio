import type { APIRoute } from "astro";
import { errorResponse, param } from "../../../../../lib/server/http.ts";
import { serveFileWithRange } from "../../../../../lib/server/serve-file.ts";
import { getRenders } from "../../../../../lib/server/studio.ts";

/** Serve a finished video or poster. Only files named by a valid manifest of this production are reachable. */
export const GET: APIRoute = async (context) => {
  try {
    const name = param(context, "file");
    const { file, mimeType } = await (await getRenders()).outputFile(param(context, "id"), name);
    return await serveFileWithRange(context.request, file, mimeType, name);
  } catch (error) {
    return errorResponse(error);
  }
};
