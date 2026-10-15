import {
  MotionStudioError,
  PreflightFailedError,
  RenderController,
  type PreflightResult,
} from "@motion-studio/core";
import { openWorkspace } from "./cli.ts";

const SYMBOL = { pass: "✓", warn: "!", fail: "✗" } as const;

export function printPreflight(result: PreflightResult): void {
  for (const check of result.checks) {
    console.error(`${SYMBOL[check.status]} ${check.label}`);
    if (check.status !== "pass")
      for (const message of check.messages) console.error(`    ${message}`);
  }
}

/** Run a render or poster job to completion, streaming progress to stderr. Returns the exit code. */
export async function runRenderJob(options: {
  productionId: string;
  profileId?: string;
  kind: "render" | "poster";
  frame?: number;
  workspace?: string;
}): Promise<number> {
  const { workspace, assets } = await openWorkspace(options.workspace);
  const controller = new RenderController(workspace, assets);
  const recovered = await controller.recover();
  if (recovered.length)
    console.error(`Marked ${recovered.length} interrupted job(s) from an earlier run.`);

  const { record } = await workspace.locate("production", options.productionId);
  const profileId =
    options.profileId ?? (record as { defaultRenderProfileId: string }).defaultRenderProfileId;

  let job;
  try {
    job = await controller.start({
      productionId: options.productionId,
      profileId,
      kind: options.kind,
      ...(options.frame !== undefined ? { frame: options.frame } : {}),
    });
  } catch (error) {
    if (error instanceof PreflightFailedError) {
      printPreflight(error.result);
      console.error("Preflight failed; nothing was rendered.");
      return 1;
    }
    throw error;
  }
  console.error(`Started ${job.renderId}`);

  const onInterrupt = () => {
    console.error("\nCancelling…");
    void controller.cancel(job.renderId).catch(() => undefined);
  };
  process.once("SIGINT", onInterrupt);
  const ticker = setInterval(async () => {
    const { state } = await controller.get(job.renderId);
    const frames =
      state.renderedFrames !== undefined
        ? ` ${state.renderedFrames}/${state.totalFrames} frames`
        : "";
    process.stderr.write(
      `\r${state.phase.padEnd(10)} ${(state.progress * 100).toFixed(0).padStart(3)}%${frames}   `,
    );
  }, 1000);

  const final = await controller.wait(job.renderId);
  clearInterval(ticker);
  process.removeListener("SIGINT", onInterrupt);
  process.stderr.write("\n");

  if (final.status !== "succeeded") {
    console.error(`${final.status}: ${final.error?.message ?? "unknown error"}`);
    console.error(`Log: .motion-studio/jobs/${final.renderId}/log.txt`);
    return 1;
  }
  for (const warning of final.warnings) console.error(`! ${warning}`);
  console.log(
    JSON.stringify(
      { renderId: final.renderId, fingerprint: final.fingerprint, ...final.outputs },
      null,
      2,
    ),
  );
  return 0;
}

export function requireProductionId(positionals: string[], usage: string): string {
  const [productionId] = positionals;
  if (!productionId || positionals.length > 1) throw new MotionStudioError("INVALID_INPUT", usage);
  return productionId;
}
