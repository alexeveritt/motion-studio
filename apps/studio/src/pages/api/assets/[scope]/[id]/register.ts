import { assetTarget } from "../../../../../lib/server/assets.ts";
import { handler, readJsonBody } from "../../../../../lib/server/http.ts";
import { getAssets } from "../../../../../lib/server/studio.ts";

/** Create a sidecar for a file copied into the folder by hand. Body: `{ fileName }`. */
export const POST = handler(
  async (context) =>
    (await getAssets()).register(...assetTarget(context), await readJsonBody(context.request)),
  201,
);
