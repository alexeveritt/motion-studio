import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { z } from "zod";
import { MotionStudioError } from "./errors.ts";
import { toRepoRelative } from "./repo.ts";
import type { ProductionRecord } from "./schemas/production.ts";
import type { RenderController } from "./render/controller.ts";
import type { WorkspaceService } from "./workspace.ts";

/**
 * Golden-frame configuration, `tests/golden.json` in a production folder.
 *
 * Tolerance: a pixel "differs" when any RGB channel differs by more than
 * `channelThreshold` (0–255). The frame passes when the share of differing
 * pixels is at most `maxDifferentRatio`. The defaults absorb anti-aliasing
 * noise between machines while catching any visible change of content.
 */
export const goldenConfigSchema = z.strictObject({
  frames: z.array(z.int().min(0)).min(1).max(60),
  profileId: z.string().default("standard"),
  tolerance: z
    .strictObject({
      channelThreshold: z.int().min(0).max(255).default(16),
      maxDifferentRatio: z.number().min(0).max(1).default(0.002),
    })
    .default({ channelThreshold: 16, maxDifferentRatio: 0.002 }),
});

export type GoldenConfig = z.infer<typeof goldenConfigSchema>;

export type ImageComparison = {
  sameSize: boolean;
  differentPixels: number;
  differentRatio: number;
  maxChannelDelta: number;
  pass: boolean;
};

/** Pixel comparison of two decoded PNGs. Optionally returns a diff image with differing pixels in red. */
export function compareImages(
  expected: PNG,
  actual: PNG,
  tolerance: GoldenConfig["tolerance"],
): ImageComparison & { diff?: PNG } {
  if (expected.width !== actual.width || expected.height !== actual.height) {
    return {
      sameSize: false,
      differentPixels: Number.NaN,
      differentRatio: 1,
      maxChannelDelta: 255,
      pass: false,
    };
  }
  const diff = new PNG({ width: expected.width, height: expected.height });
  let differentPixels = 0;
  let maxChannelDelta = 0;
  for (let i = 0; i < expected.data.length; i += 4) {
    const delta = Math.max(
      Math.abs(expected.data[i]! - actual.data[i]!),
      Math.abs(expected.data[i + 1]! - actual.data[i + 1]!),
      Math.abs(expected.data[i + 2]! - actual.data[i + 2]!),
    );
    maxChannelDelta = Math.max(maxChannelDelta, delta);
    const differs = delta > tolerance.channelThreshold;
    if (differs) differentPixels++;
    // Diff image: faded original, differing pixels solid red.
    const grey = Math.round(
      (expected.data[i]! + expected.data[i + 1]! + expected.data[i + 2]!) / 3,
    );
    diff.data[i] = differs ? 255 : 128 + grey / 2;
    diff.data[i + 1] = differs ? 0 : 128 + grey / 2;
    diff.data[i + 2] = differs ? 0 : 128 + grey / 2;
    diff.data[i + 3] = 255;
  }
  const differentRatio = differentPixels / (expected.width * expected.height);
  return {
    sameSize: true,
    differentPixels,
    differentRatio,
    maxChannelDelta,
    pass: differentRatio <= tolerance.maxDifferentRatio,
    diff,
  };
}

export type GoldenFrameResult = {
  frame: number;
  status: "pass" | "fail" | "missing-baseline" | "updated";
  baseline: string;
  actual?: string;
  diff?: string;
  comparison?: ImageComparison;
};

export type GoldenReport = {
  ok: boolean;
  productionId: string;
  renderId: string;
  tolerance: GoldenConfig["tolerance"];
  frames: GoldenFrameResult[];
};

export async function readGoldenConfig(
  workspace: WorkspaceService,
  productionId: string,
): Promise<GoldenConfig> {
  const { dir } = await workspace.locate("production", productionId);
  const file = workspace.policy.resolve(dir, "tests", "golden.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    throw new MotionStudioError(
      "NOT_FOUND",
      `${toRepoRelative(workspace.repoRoot, file)} not found. Create it with { "frames": [0, 59, 60, ...] }.`,
    );
  }
  const parsed = goldenConfigSchema.safeParse(JSON.parse(raw));
  if (!parsed.success)
    throw new MotionStudioError(
      "SCHEMA_INVALID",
      `tests/golden.json: ${parsed.error.issues[0]?.message}`,
    );
  return parsed.data;
}

/**
 * Render the configured frames and compare them with the committed
 * baselines in `tests/golden/`. With `update`, the rendered frames replace
 * the baselines instead; review the change in Git before committing.
 */
export async function runGolden(
  workspace: WorkspaceService,
  controller: RenderController,
  productionId: string,
  options: { update?: boolean } = {},
): Promise<GoldenReport> {
  const config = await readGoldenConfig(workspace, productionId);
  const { dir, record } = await workspace.locate("production", productionId);
  const lastFrame = (record as ProductionRecord).format.durationInFrames - 1;
  const outOfRange = config.frames.filter((frame) => frame > lastFrame);
  if (outOfRange.length)
    throw new MotionStudioError(
      "INVALID_INPUT",
      `Golden frames out of range: ${outOfRange.join(", ")}`,
    );

  const job = await controller.start({
    productionId,
    profileId: config.profileId,
    kind: "frames",
    frames: config.frames,
  });
  const state = await controller.wait(job.renderId);
  if (state.status !== "succeeded" || !state.outputs?.frames) {
    throw new MotionStudioError(
      "RENDER_FAILED",
      `Golden frames could not be rendered: ${state.error?.message ?? state.status}`,
    );
  }

  const baselineDir = workspace.policy.resolve(dir, "tests", "golden");
  const diffDir = workspace.policy.resolve(workspace.tmpRoot, "golden", state.renderId);
  await mkdir(baselineDir, { recursive: true });
  const results: GoldenFrameResult[] = [];

  for (const actualRelative of state.outputs.frames) {
    const actual = path.join(workspace.repoRoot, ...actualRelative.split("/"));
    const frame = Number(/frame-(\d+)\.png$/.exec(actual)![1]);
    const baseline = path.join(baselineDir, `frame-${frame}.png`);
    const baselineRelative = toRepoRelative(workspace.repoRoot, baseline);
    if (options.update) {
      await copyFile(actual, baseline);
      results.push({
        frame,
        status: "updated",
        baseline: baselineRelative,
        actual: actualRelative,
      });
      continue;
    }
    const expectedBytes = await readFile(baseline).catch(() => undefined);
    if (!expectedBytes) {
      results.push({
        frame,
        status: "missing-baseline",
        baseline: baselineRelative,
        actual: actualRelative,
      });
      continue;
    }
    const { diff, ...comparison } = compareImages(
      PNG.sync.read(expectedBytes),
      PNG.sync.read(await readFile(actual)),
      config.tolerance,
    );
    const result: GoldenFrameResult = {
      frame,
      status: comparison.pass ? "pass" : "fail",
      baseline: baselineRelative,
      actual: actualRelative,
      comparison,
    };
    if (!comparison.pass && diff) {
      await mkdir(diffDir, { recursive: true });
      const diffFile = path.join(diffDir, `frame-${frame}-diff.png`);
      await writeFile(diffFile, PNG.sync.write(diff));
      result.diff = toRepoRelative(workspace.repoRoot, diffFile);
    }
    results.push(result);
  }

  return {
    ok: results.every((result) => result.status === "pass" || result.status === "updated"),
    productionId,
    renderId: state.renderId,
    tolerance: config.tolerance,
    frames: results.sort((a, b) => a.frame - b.frame),
  };
}
