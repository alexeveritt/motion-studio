import { handler, param, readJsonBody } from "../../../lib/server/http.ts";
import { getWorkspace } from "../../../lib/server/studio.ts";

export const PATCH = handler(async (context) =>
  (await getWorkspace()).updateProduction(
    param(context, "id"),
    await readJsonBody(context.request),
  ),
);

/** Moves the production to the archive. Requires `{ confirmSlug }`. */
export const DELETE = handler(async (context) =>
  (await getWorkspace()).archive(
    "production",
    param(context, "id"),
    await readJsonBody(context.request),
  ),
);
