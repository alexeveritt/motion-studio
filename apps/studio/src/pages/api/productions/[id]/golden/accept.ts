import { acceptGoldenFrames, parseInput } from "@motion-studio/core";
import { z } from "zod";
import { handler, param, readJsonBody } from "../../../../../lib/server/http.ts";
import { getWorkspace } from "../../../../../lib/server/studio.ts";

const body = z.strictObject({
  renderId: z.string().min(1).max(100),
  frames: z.array(z.int().min(0)).min(1).max(60),
});

/** Make frames from a compared job the new committed baselines. */
export const POST = handler(async (context) => {
  const { renderId, frames } = parseInput(
    body,
    await readJsonBody(context.request),
    "baseline request",
  );
  return acceptGoldenFrames(await getWorkspace(), param(context, "id"), renderId, frames);
});
