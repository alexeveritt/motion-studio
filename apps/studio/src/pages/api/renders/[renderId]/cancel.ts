import { handler, param } from "../../../../lib/server/http.ts";
import { getRenders } from "../../../../lib/server/studio.ts";

/** Cancel the running job: SIGTERM, then SIGKILL after a grace period. */
export const POST = handler(async (context) =>
  (await getRenders()).cancel(param(context, "renderId")),
);
