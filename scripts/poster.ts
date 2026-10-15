/**
 * Render a single poster frame to PNG with its own manifest.
 *
 *   pnpm poster -- <production-id> --frame <frame-number> [--profile <profile-id>]
 */
import { MotionStudioError } from "@motion-studio/core";
import { parseCliArgs, runCli } from "./lib/cli.ts";
import { requireProductionId, runRenderJob } from "./lib/render-cli.ts";

await runCli(async () => {
  const { positionals, values } = parseCliArgs(
    { frame: { type: "string" }, profile: { type: "string" }, workspace: { type: "string" } },
    true,
  );
  const usage = "Usage: pnpm poster -- <production-id> --frame <frame-number>";
  const frame = values.frame === undefined ? undefined : Number(values.frame);
  if (frame !== undefined && !Number.isInteger(frame))
    throw new MotionStudioError("INVALID_INPUT", usage);
  return runRenderJob({
    productionId: requireProductionId(positionals, usage),
    kind: "poster",
    ...(frame !== undefined ? { frame } : {}),
    ...(values.profile ? { profileId: values.profile } : {}),
    ...(values.workspace ? { workspace: values.workspace } : {}),
  });
});
