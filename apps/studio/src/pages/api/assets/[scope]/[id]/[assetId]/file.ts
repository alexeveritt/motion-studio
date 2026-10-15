import type { APIRoute } from "astro";
import { assetTarget } from "../../../../../../lib/server/assets.ts";
import { errorResponse, param } from "../../../../../../lib/server/http.ts";
import { serveAsset } from "../../../../../../lib/server/serve-file.ts";
import { getAssets } from "../../../../../../lib/server/studio.ts";

/** Serve an asset by opaque ID. */
export const GET: APIRoute = async (context) => {
  try {
    const { file, record } = await (
      await getAssets()
    ).open(...assetTarget(context), param(context, "assetId"));
    return await serveAsset(file, record);
  } catch (error) {
    return errorResponse(error);
  }
};
