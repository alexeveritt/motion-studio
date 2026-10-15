import { handler, param, readJsonBody } from "../../../../../lib/server/http.ts";
import { getApprovals } from "../../../../../lib/server/studio.ts";

/**
 * Move finished renders to the archive. Body: `{ renderIds }`. 409 IN_USE for
 * the approved render. Nothing is deleted.
 */
export const POST = handler(async (context) =>
  (await getApprovals()).archiveRenders(param(context, "id"), await readJsonBody(context.request)),
);
