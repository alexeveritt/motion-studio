import { buildContextPacket } from "@motion-studio/core";
import type { APIRoute } from "astro";
import { errorResponse, param } from "../../../../lib/server/http.ts";
import { getAssets, getWorkspace } from "../../../../lib/server/studio.ts";

/** The Claude-ready context packet as Markdown text. */
export const GET: APIRoute = async (context) => {
  try {
    const text = await buildContextPacket(
      await getWorkspace(),
      await getAssets(),
      param(context, "id"),
      {
        studioUrl: context.url.origin,
      },
    );
    return new Response(text, {
      headers: { "Content-Type": "text/markdown; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return errorResponse(error);
  }
};
