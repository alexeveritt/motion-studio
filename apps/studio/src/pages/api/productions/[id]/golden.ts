import { goldenStatus, startGolden } from "@motion-studio/core";
import { handler, param } from "../../../../lib/server/http.ts";
import { getRenders, getWorkspace } from "../../../../lib/server/studio.ts";

/** tests/golden.json, which baselines exist, and the latest comparison. */
export const GET = handler(async (context) =>
  goldenStatus(await getWorkspace(), param(context, "id")),
);

/** Render the configured golden frames. Poll /api/renders/<renderId>, then POST compare. */
export const POST = handler(
  async (context) => startGolden(await getWorkspace(), await getRenders(), param(context, "id")),
  202,
);
