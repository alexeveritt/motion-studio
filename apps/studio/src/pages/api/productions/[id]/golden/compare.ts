import { compareGolden, parseInput } from "@motion-studio/core";
import { z } from "zod";
import { handler, param, readJsonBody } from "../../../../../lib/server/http.ts";
import { getRenders, getWorkspace } from "../../../../../lib/server/studio.ts";

const body = z.strictObject({ renderId: z.string().min(1).max(100) });

/** Compare a finished golden-frames job with the committed baselines. */
export const POST = handler(async (context) => {
  const { renderId } = parseInput(body, await readJsonBody(context.request), "compare request");
  return compareGolden(await getWorkspace(), await getRenders(), param(context, "id"), renderId);
});
