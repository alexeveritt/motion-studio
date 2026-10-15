import type { APIRoute } from "astro";
import { assetTarget } from "../../../../../../lib/server/assets.ts";
import { errorResponse, param } from "../../../../../../lib/server/http.ts";
import { serveAsset } from "../../../../../../lib/server/serve-file.ts";
import { getAssets } from "../../../../../../lib/server/studio.ts";

/**
 * The preview's asset resolver: serves `useAsset("<scope>:<name>")` for a
 * production. Only registered assets in the production's own scope chain are
 * reachable.
 */
export const GET: APIRoute = async (context) => {
  try {
    const [scope, productionId] = assetTarget(context);
    const { file, record } = await (
      await getAssets()
    ).openForProduction(productionId, scope, param(context, "name"));
    return await serveAsset(file, record);
  } catch (error) {
    return errorResponse(error);
  }
};
