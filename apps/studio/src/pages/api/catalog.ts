import { getCatalog } from "../../lib/server/studio.ts";
import { handler } from "../../lib/server/http.ts";

export const GET = handler(() => getCatalog());
