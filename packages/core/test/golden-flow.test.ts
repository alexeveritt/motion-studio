import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AssetLibrary } from "../src/assets.ts";
import { acceptGoldenFrames, compareGolden, goldenImageFile, goldenStatus } from "../src/golden.ts";
import { RenderController, type JobState } from "../src/render/controller.ts";
import { loadSettings, toRepoRelative } from "../src/repo.ts";
import { WorkspaceService } from "../src/workspace.ts";
import { makeEmptyRepo } from "./helpers.ts";
import { makePng } from "./media-fixtures.ts";

/**
 * The studio's golden-frame flow without rendering: finished frames jobs are
 * written to disk the way the render controller leaves them.
 */
let workspace: WorkspaceService;
let controller: RenderController;
let productionId: string;
let otherProductionId: string;
let dir: string;
let jobCount = 0;

const RED: [number, number, number] = [200, 40, 40];
const BLUE: [number, number, number] = [40, 40, 200];

async function fakeFramesJob(
  frames: Record<number, [number, number, number]>,
  options: { productionId?: string; kind?: JobState["kind"]; status?: JobState["status"] } = {},
): Promise<string> {
  jobCount += 1;
  const renderId = `20261015-12000${jobCount}_clip_standard_abcdef0${jobCount}`;
  const framesDir = path.join(workspace.tmpRoot, "golden", renderId);
  await mkdir(framesDir, { recursive: true });
  const outputs: string[] = [];
  for (const [frame, colour] of Object.entries(frames)) {
    const file = path.join(framesDir, `frame-${frame}.png`);
    await writeFile(file, makePng(8, 8, colour));
    outputs.push(toRepoRelative(workspace.repoRoot, file));
  }
  const jobDir = path.join(workspace.jobsRoot, renderId);
  await mkdir(jobDir, { recursive: true });
  const state: JobState = {
    schemaVersion: 1,
    renderId,
    kind: options.kind ?? "frames",
    productionId: options.productionId ?? productionId,
    productionSlug: "clip",
    profileId: "standard",
    fingerprint: "0".repeat(64),
    status: options.status ?? "succeeded",
    phase: "done",
    progress: 1,
    totalFrames: outputs.length,
    requestedAt: "2026-10-15T12:00:00.000Z",
    startedAt: "2026-10-15T12:00:00.000Z",
    completedAt: "2026-10-15T12:00:05.000Z",
    outputs: { frames: outputs },
    warnings: [],
  };
  await writeFile(path.join(jobDir, "job.json"), JSON.stringify(state));
  return renderId;
}

beforeEach(async () => {
  jobCount = 0;
  const { repoRoot, workspaceRoot } = await makeEmptyRepo();
  workspace = new WorkspaceService({
    repoRoot,
    workspaceRoot,
    settings: await loadSettings(repoRoot),
    now: () => new Date("2026-10-15T13:00:00.000Z"),
  });
  controller = new RenderController(workspace, new AssetLibrary(workspace));
  const project = await workspace.createProject({ name: "Golden" });
  const campaign = await workspace.createCampaign(project.id, { name: "Tests" });
  const format = { width: 240, height: 320, fps: 30, durationInFrames: 30 };
  productionId = (await workspace.createProduction(campaign.id, { title: "Clip", format })).id;
  otherProductionId = (await workspace.createProduction(campaign.id, { title: "Other", format }))
    .id;
  dir = path.join(workspaceRoot, "golden/campaigns/tests/productions/clip");
  await mkdir(path.join(dir, "tests"), { recursive: true });
  await writeFile(path.join(dir, "tests/golden.json"), JSON.stringify({ frames: [0, 15] }));
});

describe("golden status", () => {
  it("reports a missing or broken configuration without throwing", async () => {
    const other = await goldenStatus(workspace, otherProductionId);
    expect(other).toEqual({
      configPath: "workspace/projects/golden/campaigns/tests/productions/other/tests/golden.json",
      baselines: [],
    });
    await writeFile(path.join(dir, "tests/golden.json"), "{ nope");
    expect((await goldenStatus(workspace, productionId)).configError).toBe(
      "tests/golden.json is not valid JSON",
    );
    await writeFile(path.join(dir, "tests/golden.json"), JSON.stringify({ frames: [] }));
    expect((await goldenStatus(workspace, productionId)).configError).toMatch(
      /^tests\/golden.json frames: /,
    );
  });

  it("lists baselines and the latest report", async () => {
    const before = await goldenStatus(workspace, productionId);
    expect(before.config?.frames).toEqual([0, 15]);
    expect(before.baselines.map((b) => b.exists)).toEqual([false, false]);
    expect(before.latest).toBeUndefined();

    const renderId = await fakeFramesJob({ 0: RED, 15: RED });
    const report = await compareGolden(workspace, controller, productionId, renderId);
    expect(report.frames.map((f) => f.status)).toEqual(["missing-baseline", "missing-baseline"]);
    expect(report.ok).toBe(false);
    expect((await goldenStatus(workspace, productionId)).latest).toEqual(report);
    // Another production's report is not shown here.
    expect((await goldenStatus(workspace, otherProductionId)).latest).toBeUndefined();
  });
});

describe("compare and accept", () => {
  it("saves baselines, then passes identical frames and flags changed ones", async () => {
    const first = await fakeFramesJob({ 0: RED, 15: RED });
    await compareGolden(workspace, controller, productionId, first);
    const accepted = await acceptGoldenFrames(workspace, productionId, first, [0, 15]);
    expect(accepted.ok).toBe(true);
    expect(accepted.frames.map((f) => f.status)).toEqual(["updated", "updated"]);
    expect(await readFile(path.join(dir, "tests/golden/frame-0.png"))).toEqual(makePng(8, 8, RED));
    expect((await goldenStatus(workspace, productionId)).baselines.every((b) => b.exists)).toBe(
      true,
    );

    const same = await compareGolden(
      workspace,
      controller,
      productionId,
      await fakeFramesJob({ 0: RED, 15: RED }),
    );
    expect(same.ok).toBe(true);
    expect(same.frames.map((f) => f.status)).toEqual(["pass", "pass"]);
    expect(same.frames.every((f) => f.diff)).toBe(true);

    const changedId = await fakeFramesJob({ 0: RED, 15: BLUE });
    const changed = await compareGolden(workspace, controller, productionId, changedId);
    expect(changed.ok).toBe(false);
    expect(changed.frames[1]).toMatchObject({
      frame: 15,
      status: "fail",
      comparison: { differentRatio: 1, maxChannelDelta: 160 },
    });

    const fixed = await acceptGoldenFrames(workspace, productionId, changedId, [15]);
    expect(fixed.ok).toBe(true);
    expect(fixed.frames[1]).toEqual({
      frame: 15,
      status: "updated",
      baseline: changed.frames[1]!.baseline,
      actual: changed.frames[1]!.actual,
    });
    expect(await readFile(path.join(dir, "tests/golden/frame-15.png"))).toEqual(
      makePng(8, 8, BLUE),
    );
    expect((await goldenStatus(workspace, productionId)).latest).toEqual(fixed);
  });

  it("only compares finished frames jobs of the same production", async () => {
    const foreign = await fakeFramesJob({ 0: RED }, { productionId: otherProductionId });
    await expect(compareGolden(workspace, controller, productionId, foreign)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
    const video = await fakeFramesJob({ 0: RED }, { kind: "render" });
    await expect(compareGolden(workspace, controller, productionId, video)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const failed = await fakeFramesJob({ 0: RED }, { status: "failed" });
    await expect(compareGolden(workspace, controller, productionId, failed)).rejects.toMatchObject({
      code: "RENDER_FAILED",
    });
    await expect(
      compareGolden(workspace, controller, productionId, "../../etc"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("accepts only frames from a report of this production", async () => {
    const renderId = await fakeFramesJob({ 0: RED, 15: RED });
    await compareGolden(workspace, controller, productionId, renderId);
    await expect(
      acceptGoldenFrames(workspace, otherProductionId, renderId, [0]),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(acceptGoldenFrames(workspace, productionId, renderId, [7])).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Frame 7 is not in this report",
    });
    await expect(acceptGoldenFrames(workspace, productionId, renderId, [])).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});

describe("golden images", () => {
  it("resolves baselines, frames and diffs only within this production's reports", async () => {
    const renderId = await fakeFramesJob({ 0: RED, 15: RED });
    await compareGolden(workspace, controller, productionId, renderId);
    expect(await goldenImageFile(workspace, productionId, "baseline", 15)).toBe(
      path.join(dir, "tests/golden/frame-15.png"),
    );
    expect(await goldenImageFile(workspace, productionId, "actual", 0, renderId)).toBe(
      path.join(workspace.tmpRoot, "golden", renderId, "frame-0.png"),
    );
    expect(await goldenImageFile(workspace, productionId, "diff", 0, renderId)).toBe(
      path.join(workspace.tmpRoot, "golden", renderId, "frame-0-diff.png"),
    );
    for (const attempt of [
      () => goldenImageFile(workspace, otherProductionId, "actual", 0, renderId),
      () => goldenImageFile(workspace, productionId, "actual", 0),
      () => goldenImageFile(workspace, productionId, "actual", 0, "../../../x"),
      () => goldenImageFile(workspace, productionId, "baseline", -1),
      () => goldenImageFile(workspace, productionId, "baseline", 1.5),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
});
