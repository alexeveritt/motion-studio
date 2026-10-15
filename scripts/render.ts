/**
 * Render a production to MP4 with a poster and manifest.
 *
 *   pnpm render -- <production-id> --profile <profile-id>
 */
import { parseCliArgs, runCli } from "./lib/cli.ts";
import { requireProductionId, runRenderJob } from "./lib/render-cli.ts";

await runCli(async () => {
  const { positionals, values } = parseCliArgs(
    { profile: { type: "string" }, workspace: { type: "string" } },
    true,
  );
  return runRenderJob({
    productionId: requireProductionId(
      positionals,
      "Usage: pnpm render -- <production-id> --profile <profile-id>",
    ),
    kind: "render",
    ...(values.profile ? { profileId: values.profile } : {}),
    ...(values.workspace ? { workspace: values.workspace } : {}),
  });
});
