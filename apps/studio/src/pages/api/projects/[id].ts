import { handler, param, readJsonBody } from "../../../lib/server/http.ts";
import { getWorkspace } from "../../../lib/server/studio.ts";

export const PATCH = handler(async (context) =>
  (await getWorkspace()).updateProject(param(context, "id"), await readJsonBody(context.request)),
);

/** Moves the project to the archive. Requires `{ confirmSlug }`. */
export const DELETE = handler(async (context) =>
  (await getWorkspace()).archive(
    "project",
    param(context, "id"),
    await readJsonBody(context.request),
  ),
);
