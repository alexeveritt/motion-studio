import { parseInput } from "@motion-studio/core";
import { z } from "zod";
import { handler, param, readJsonBody } from "../../../../lib/server/http.ts";
import { getApprovals, getRenders } from "../../../../lib/server/studio.ts";

const body = z.strictObject({ profileId: z.string().min(1).max(64) });

/** Output history: successful manifests, recent unsuccessful jobs, the active render and the approval. */
export const GET = handler(async (context) => {
  const renders = await getRenders();
  const id = param(context, "id");
  return {
    ...(await renders.history(id)),
    activeRenderId: renders.activeRenderId ?? null,
    approval: await (await getApprovals()).status(id),
  };
});

/** Start a render. 409 when another render is running; 422 with the preflight result when it fails. */
export const POST = handler(async (context) => {
  const { profileId } = parseInput(body, await readJsonBody(context.request), "render request");
  return (await getRenders()).start({ productionId: param(context, "id"), profileId });
}, 202);
