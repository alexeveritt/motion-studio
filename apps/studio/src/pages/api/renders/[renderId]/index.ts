import { handler, param } from "../../../../lib/server/http.ts";
import { getRenders } from "../../../../lib/server/studio.ts";

const LOG_LINES = 200;

/** Job state, progress and the most recent log lines. */
export const GET = handler(async (context) => {
  const view = await (await getRenders()).get(param(context, "renderId"));
  return { state: view.state, log: view.log.slice(-LOG_LINES) };
});
