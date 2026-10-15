/**
 * Print the Claude context packet for a production.
 *
 *   pnpm -s context-packet -- <production-id>
 */
import { buildContextPacket, MotionStudioError } from "@motion-studio/core";
import { openWorkspace, parseCliArgs, runCli } from "./lib/cli.ts";

await runCli(async () => {
  const { positionals, values } = parseCliArgs({ workspace: { type: "string" } }, true);
  const [productionId] = positionals;
  if (!productionId || positionals.length > 1) {
    throw new MotionStudioError(
      "INVALID_INPUT",
      "Usage: pnpm -s context-packet -- <production-id>",
    );
  }
  const { workspace, assets } = await openWorkspace(values.workspace);
  const port = workspace.settings.server.port;
  process.stdout.write(
    await buildContextPacket(workspace, assets, productionId, {
      studioUrl: `http://127.0.0.1:${port}`,
    }),
  );
});
