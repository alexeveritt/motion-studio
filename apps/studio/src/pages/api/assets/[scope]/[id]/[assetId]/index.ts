import { assetTarget } from "../../../../../../lib/server/assets.ts";
import { handler, param, readJsonBody } from "../../../../../../lib/server/http.ts";
import { getAssets } from "../../../../../../lib/server/studio.ts";

/** Update alt text, source and licence notes. Body includes `baseHash` of the sidecar. */
export const PATCH = handler(async (context) =>
  (await getAssets()).updateMetadata(
    ...assetTarget(context),
    param(context, "assetId"),
    await readJsonBody(context.request),
  ),
);

/** Move an unused asset to the archive. Body: `{ confirmName }`. */
export const DELETE = handler(async (context) =>
  (await getAssets()).archive(
    ...assetTarget(context),
    param(context, "assetId"),
    await readJsonBody(context.request),
  ),
);
