import { z } from "zod";
import { parseInput } from "@motion-studio/core";
import { handler, param, readJsonBody } from "../../../../lib/server/http.ts";
import { getRenders } from "../../../../lib/server/studio.ts";

const body = z.strictObject({ profileId: z.string().min(1).max(64) });

/** Run the pre-render checks. Body: `{ profileId }`. */
export const POST = handler(async (context) => {
  const { profileId } = parseInput(body, await readJsonBody(context.request), "preflight request");
  return (await getRenders()).preflight(param(context, "id"), profileId);
});
