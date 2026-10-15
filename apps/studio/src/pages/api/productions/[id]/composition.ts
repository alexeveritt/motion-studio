import { handler, param } from "../../../../lib/server/http.ts";
import { getWorkspace, refreshRegistry } from "../../../../lib/server/studio.ts";

/** Create the placeholder entry file for a production that has none. Never overwrites. */
export const POST = handler(async (context) => {
  const created = await (await getWorkspace()).createPlaceholderComposition(param(context, "id"));
  await refreshRegistry();
  return created;
}, 201);
