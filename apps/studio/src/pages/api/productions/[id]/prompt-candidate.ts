import { createPromptCandidate } from "@motion-studio/core";
import { handler, param } from "../../../../lib/server/http.ts";
import { getWorkspace } from "../../../../lib/server/studio.ts";

/**
 * Regenerate prompt.md from the template into a gitignored candidate file and
 * return a diff. The saved prompt is untouched until the operator replaces it.
 */
export const POST = handler(
  async (context) => createPromptCandidate(await getWorkspace(), param(context, "id")),
  201,
);
