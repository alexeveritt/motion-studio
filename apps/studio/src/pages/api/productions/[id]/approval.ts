import { handler, param, readJsonBody } from "../../../../lib/server/http.ts";
import { getApprovals } from "../../../../lib/server/studio.ts";

/** The production's approved render, checked against its files and current inputs. */
export const GET = handler(async (context) => (await getApprovals()).status(param(context, "id")));

/** Approve a render. Body: `{ renderId, baseHash, note? }`; 409 when approved.json changed meanwhile. */
export const PUT = handler(async (context) =>
  (await getApprovals()).approve(param(context, "id"), await readJsonBody(context.request)),
);

/** Withdraw the approval. Body: `{ baseHash }`. The render itself is kept. */
export const DELETE = handler(async (context) =>
  (await getApprovals()).remove(param(context, "id"), await readJsonBody(context.request)),
);
