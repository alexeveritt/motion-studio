import { handler, readJsonBody } from "../../../lib/server/http.ts";
import { getWorkspace } from "../../../lib/server/studio.ts";

export const POST = handler(
  async ({ request }) => (await getWorkspace()).createProject(await readJsonBody(request)),
  201,
);
