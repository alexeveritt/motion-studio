import { handler, param, readJsonBody } from "../../../../lib/server/http.ts";
import { getWorkspace, refreshRegistry } from "../../../../lib/server/studio.ts";

export const POST = handler(async (context) => {
  const production = await (
    await getWorkspace()
  ).createProduction(param(context, "id"), await readJsonBody(context.request));
  // New productions are scaffolded with a placeholder entry; add it to the registry.
  await refreshRegistry();
  return production;
}, 201);
