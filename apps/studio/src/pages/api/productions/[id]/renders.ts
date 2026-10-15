import { parseInput } from "@motion-studio/core";
import { z } from "zod";
import { handler, param, readJsonBody } from "../../../../lib/server/http.ts";
import { getRenders } from "../../../../lib/server/studio.ts";

const body = z.strictObject({ profileId: z.string().min(1).max(64) });

/** Output history: successful manifests, recent unsuccessful jobs and the active render. */
export const GET = handler(async (context) => {
  const renders = await getRenders();
  return {
    ...(await renders.history(param(context, "id"))),
    activeRenderId: renders.activeRenderId ?? null,
  };
});

/** Start a render. 409 when another render is running; 422 with the preflight result when it fails. */
export const POST = handler(async (context) => {
  const { profileId } = parseInput(body, await readJsonBody(context.request), "render request");
  return (await getRenders()).start({ productionId: param(context, "id"), profileId });
}, 202);
