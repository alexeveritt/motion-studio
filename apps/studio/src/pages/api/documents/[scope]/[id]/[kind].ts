import { MotionStudioError, scope as scopeSchema, type Scope } from "@motion-studio/core";
import type { APIContext } from "astro";
import { handler, param, readJsonBody } from "../../../../../lib/server/http.ts";
import { getWorkspace } from "../../../../../lib/server/studio.ts";

function target(context: APIContext): [Scope, string, string] {
  const parsed = scopeSchema.safeParse(param(context, "scope"));
  if (!parsed.success) throw new MotionStudioError("NOT_FOUND", "Unknown document scope");
  return [parsed.data, param(context, "id"), param(context, "kind")];
}

export const GET = handler(async (context) =>
  (await getWorkspace()).readDocument(...target(context)),
);

/** Save a document. Body: `{ content, baseHash }`; a stale baseHash returns 409. */
export const PUT = handler(async (context) =>
  (await getWorkspace()).saveDocument(
    ...target(context),
    await readJsonBody(context.request, 600 * 1024),
  ),
);
