import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { z } from "zod";
import { MotionStudioError } from "./errors.ts";
import { serializeJson, writeFileAtomic } from "./fs-store.ts";
import { toRepoRelative } from "./repo.ts";
import type { ProductionRecord } from "./schemas/production.ts";
import type { JobState, RenderController } from "./render/controller.ts";
import { isRenderId } from "./render/naming.ts";
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
  profileId: string;
  comparedAt: string;
  tolerance: GoldenConfig["tolerance"];
  frames: GoldenFrameResult[];
};

const REPORT_FILE = "report.json";
const FRAME_FILE = /^frame-(\d+)\.png$/;

/** Read and validate tests/golden.json. NOT_FOUND when absent, SCHEMA_INVALID when broken. */
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
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new MotionStudioError("SCHEMA_INVALID", "tests/golden.json is not valid JSON");
  }
  const parsed = goldenConfigSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new MotionStudioError(
      "SCHEMA_INVALID",
      `tests/golden.json${issue?.path.length ? ` ${issue.path.join(".")}` : ""}: ${issue?.message}`,
    );
  }
  return parsed.data;
}

export type GoldenStatus = {
  /** Repository-relative path of tests/golden.json. */
  configPath: string;
  config?: GoldenConfig;
  configError?: string;
  /** Each configured frame and whether its committed baseline exists. */
  baselines: { frame: number; path: string; exists: boolean }[];
  /** The most recent comparison for this production, from the studio or `pnpm golden`. */
  latest?: GoldenReport;
};

/** Configuration, baselines and the latest report, for the studio's Golden frames tab. */
export async function goldenStatus(
  workspace: WorkspaceService,
  productionId: string,
): Promise<GoldenStatus> {
  const { dir } = await workspace.locate("production", productionId);
  const configPath = toRepoRelative(
    workspace.repoRoot,
    workspace.policy.resolve(dir, "tests", "golden.json"),
  );
  let config: GoldenConfig | undefined;
  let configError: string | undefined;
  try {
    config = await readGoldenConfig(workspace, productionId);
  } catch (error) {
    if (!(error instanceof MotionStudioError)) throw error;
    if (error.code !== "NOT_FOUND") configError = error.message;
  }
  const baselines = await Promise.all(
    (config?.frames ?? []).map(async (frame) => {
      const file = baselineFile(workspace, dir, frame);
      return {
        frame,
        path: toRepoRelative(workspace.repoRoot, file),
        exists: await readFile(file).then(
          () => true,
          () => false,
        ),
      };
    }),
  );
  const latest = await latestReport(workspace, productionId);
  return {
    configPath,
    ...(config ? { config } : {}),
    ...(configError ? { configError } : {}),
    baselines,
    ...(latest ? { latest } : {}),
  };
}

/** Start rendering the configured frames. Throws BUSY or PREFLIGHT_FAILED like any render. */
export async function startGolden(
  workspace: WorkspaceService,
  controller: RenderController,
  productionId: string,
): Promise<JobState> {
  const config = await readGoldenConfig(workspace, productionId);
  const { record } = await workspace.locate("production", productionId);
  const lastFrame = (record as ProductionRecord).format.durationInFrames - 1;
  const outOfRange = config.frames.filter((frame) => frame > lastFrame);
  if (outOfRange.length)
    throw new MotionStudioError(
      "INVALID_INPUT",
      `Golden frames out of range: ${outOfRange.join(", ")}`,
    );
  return controller.start({
    productionId,
    profileId: config.profileId,
    kind: "frames",
    frames: config.frames,
  });
}

/**
 * Compare a finished golden-frames job with the committed baselines in
 * `tests/golden/`, writing diff images and the report next to the rendered
 * frames (gitignored). With `update`, the rendered frames replace the
 * baselines instead; review the change in Git before committing.
 */
export async function compareGolden(
  workspace: WorkspaceService,
  controller: RenderController,
  productionId: string,
  renderId: string,
  options: { update?: boolean } = {},
): Promise<GoldenReport> {
  const { state } = await controller.get(renderId);
  if (state.productionId !== productionId || state.kind !== "frames")
    throw new MotionStudioError("NOT_FOUND", "No golden-frames job of this production has that ID");
  if (state.status !== "succeeded" || !state.outputs?.frames) {
    throw new MotionStudioError(
      "RENDER_FAILED",
      `Golden frames could not be rendered: ${state.error?.message ?? state.status}`,
    );
  }
  const config = await readGoldenConfig(workspace, productionId);
  const { dir } = await workspace.locate("production", productionId);
  const framesDir = workspace.policy.resolve(workspace.tmpRoot, "golden", renderId);
  await mkdir(workspace.policy.resolve(dir, "tests", "golden"), { recursive: true });
  const results: GoldenFrameResult[] = [];

  for (const actualRelative of state.outputs.frames) {
    const frame = Number(FRAME_FILE.exec(path.posix.basename(actualRelative))![1]);
    const actual = workspace.policy.resolve(framesDir, `frame-${frame}.png`);
    const baseline = baselineFile(workspace, dir, frame);
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
    // Diff images for every compared frame, so a pass can be inspected too.
    if (diff) {
      const diffFile = path.join(framesDir, `frame-${frame}-diff.png`);
      await writeFile(diffFile, PNG.sync.write(diff));
      result.diff = toRepoRelative(workspace.repoRoot, diffFile);
    }
    results.push(result);
  }

  const report: GoldenReport = {
    ok: reportOk(results),
    productionId,
    renderId,
    profileId: state.profileId,
    comparedAt: workspace.timestamp(),
    tolerance: config.tolerance,
    frames: results.sort((a, b) => a.frame - b.frame),
  };
  await writeFileAtomic(path.join(framesDir, REPORT_FILE), serializeJson(report));
  return report;
}

/**
 * Render the configured frames and compare them with the committed
 * baselines in one call (the CLI and the acceptance test). With `update`,
 * the rendered frames replace the baselines instead.
 */
export async function runGolden(
  workspace: WorkspaceService,
  controller: RenderController,
  productionId: string,
  options: { update?: boolean } = {},
): Promise<GoldenReport> {
  const job = await startGolden(workspace, controller, productionId);
  await controller.wait(job.renderId);
  return compareGolden(workspace, controller, productionId, job.renderId, options);
}

/**
 * Make the frames rendered in a compared job the new baselines for the given
 * frames. Baselines are committed files, so this is a deliberate operator
 * action; the change shows up in Git for review.
 */
export async function acceptGoldenFrames(
  workspace: WorkspaceService,
  productionId: string,
  renderId: string,
  frames: number[],
): Promise<GoldenReport> {
  const report = await readReport(workspace, renderId);
  if (!report || report.productionId !== productionId)
    throw new MotionStudioError("NOT_FOUND", "No golden report of this production has that ID");
  if (frames.length === 0)
    throw new MotionStudioError("INVALID_INPUT", "Choose at least one frame");
  const { dir } = await workspace.locate("production", productionId);
  const framesDir = workspace.policy.resolve(workspace.tmpRoot, "golden", renderId);
  for (const frame of frames) {
    const result = report.frames.find((entry) => entry.frame === frame);
    if (!result) throw new MotionStudioError("NOT_FOUND", `Frame ${frame} is not in this report`);
    const actual = workspace.policy.resolve(framesDir, `frame-${frame}.png`);
    await copyFile(actual, baselineFile(workspace, dir, frame));
    result.status = "updated";
    delete result.comparison;
    delete result.diff;
  }
  report.ok = reportOk(report.frames);
  await writeFileAtomic(path.join(framesDir, REPORT_FILE), serializeJson(report));
  return report;
}

/** Resolve one golden image for serving: a committed baseline, or a rendered frame or diff from a report. */
export async function goldenImageFile(
  workspace: WorkspaceService,
  productionId: string,
  kind: "baseline" | "actual" | "diff",
  frame: number,
  renderId?: string,
): Promise<string> {
  if (!Number.isInteger(frame) || frame < 0)
    throw new MotionStudioError("NOT_FOUND", "No such frame");
  const { dir } = await workspace.locate("production", productionId);
  if (kind === "baseline") return baselineFile(workspace, dir, frame);
  if (!renderId || !isRenderId(renderId)) throw new MotionStudioError("NOT_FOUND", "No such frame");
  const report = await readReport(workspace, renderId);
  if (report?.productionId !== productionId)
    throw new MotionStudioError("NOT_FOUND", "No such frame");
  return workspace.policy.resolve(
    workspace.tmpRoot,
    "golden",
    renderId,
    kind === "diff" ? `frame-${frame}-diff.png` : `frame-${frame}.png`,
  );
}

function baselineFile(workspace: WorkspaceService, productionDir: string, frame: number): string {
  return workspace.policy.resolve(productionDir, "tests", "golden", `frame-${frame}.png`);
}

function reportOk(frames: GoldenFrameResult[]): boolean {
  return frames.every((frame) => frame.status === "pass" || frame.status === "updated");
}

async function readReport(
  workspace: WorkspaceService,
  renderId: string,
): Promise<GoldenReport | undefined> {
  if (!isRenderId(renderId)) return undefined;
  try {
    const file = workspace.policy.resolve(workspace.tmpRoot, "golden", renderId, REPORT_FILE);
    return JSON.parse(await readFile(file, "utf8")) as GoldenReport;
  } catch {
    return undefined;
  }
}

async function latestReport(
  workspace: WorkspaceService,
  productionId: string,
): Promise<GoldenReport | undefined> {
  const root = workspace.policy.resolve(workspace.tmpRoot, "golden");
  // Render IDs start with a UTC timestamp, so a reverse sort is newest first.
  const ids = (await readdir(root).catch(() => [])).filter(isRenderId).sort().reverse();
  for (const id of ids) {
    const report = await readReport(workspace, id);
    if (report?.productionId === productionId) return report;
  }
  return undefined;
}
