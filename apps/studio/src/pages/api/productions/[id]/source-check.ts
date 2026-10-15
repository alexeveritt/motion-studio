import { checkProductionSource } from "@motion-studio/core";
import { handler, param } from "../../../../lib/server/http.ts";
import { getWorkspace } from "../../../../lib/server/studio.ts";

/** Type-check the production's src/ folder and return diagnostics with locations. */
export const GET = handler(async (context) =>
  checkProductionSource(await getWorkspace(), param(context, "id")),
);
