import { parseInput } from "@motion-studio/core";
import { z } from "zod";
import { handler, param, readJsonBody } from "../../../../lib/server/http.ts";
import { getRenders } from "../../../../lib/server/studio.ts";

const body = z.strictObject({
  profileId: z.string().min(1).max(64),
  frame: z.int().min(0).optional(),
});

/** Render a single poster frame. Body: `{ profileId, frame? }`; frame defaults to the production's poster frame. */
export const POST = handler(async (context) => {
  const { profileId, frame } = parseInput(
    body,
    await readJsonBody(context.request),
    "poster request",
  );
  return (await getRenders()).start({
    productionId: param(context, "id"),
    profileId,
    kind: "poster",
    ...(frame !== undefined ? { frame } : {}),
  });
}, 202);
