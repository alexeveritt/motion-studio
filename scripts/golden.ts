/**
 * Golden-frame test for a production: render the frames listed in
 * tests/golden.json and compare them with tests/golden/frame-<n>.png.
 *
 *   pnpm golden -- <production-id>            compare (exit 1 on any difference)
 *   pnpm golden -- <production-id> --update   replace the baselines; review in Git before committing
 */
import { RenderController, runGolden } from "@motion-studio/core";
import { openWorkspace, parseCliArgs, runCli } from "./lib/cli.ts";
import { requireProductionId } from "./lib/render-cli.ts";

await runCli(async () => {
  const { positionals, values } = parseCliArgs(
    { update: { type: "boolean" }, workspace: { type: "string" } },
    true,
  );
  const productionId = requireProductionId(
    positionals,
    "Usage: pnpm golden -- <production-id> [--update]",
  );
  const { workspace, assets } = await openWorkspace(values.workspace);
  const controller = new RenderController(workspace, assets);
  await controller.recover();
  console.error("Rendering golden frames…");
  const report = await runGolden(workspace, controller, productionId, {
    update: values.update ?? false,
  });
  const { channelThreshold, maxDifferentRatio } = report.tolerance;
  console.error(
    `Tolerance: channel difference > ${channelThreshold}, at most ${(maxDifferentRatio * 100).toFixed(2)}% of pixels`,
  );
  for (const frame of report.frames) {
    const detail = frame.comparison
      ? ` ${(frame.comparison.differentRatio * 100).toFixed(3)}% differ, max channel Δ ${frame.comparison.maxChannelDelta}`
      : "";
    console.error(
      `${frame.status.padEnd(16)} frame ${String(frame.frame).padStart(4)}${detail}${frame.diff ? `  diff: ${frame.diff}` : ""}`,
    );
  }
  if (values.update)
    console.error("Baselines updated. Review them with git diff before committing.");
  return report.ok ? 0 : 1;
});
