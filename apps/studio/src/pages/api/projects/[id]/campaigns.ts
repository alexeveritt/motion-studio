import { handler, param, readJsonBody } from "../../../../lib/server/http.ts";
import { getWorkspace } from "../../../../lib/server/studio.ts";

export const POST = handler(
  async (context) =>
    (await getWorkspace()).createCampaign(
      param(context, "id"),
      await readJsonBody(context.request),
    ),
  201,
);
