import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AssetLibrary } from "../src/assets.ts";
import { loadSettings } from "../src/repo.ts";
import { canonicalJson } from "../src/render/canonical.ts";
import { RenderController } from "../src/render/controller.ts";
import {
  computeFingerprint,
  gatherFingerprintInputs,
  type FingerprintInputs,
} from "../src/render/fingerprint.ts";
import { isRenderId, outputNames, renderBaseName } from "../src/render/naming.ts";
import { mediaRenderOptions, outputSize, sampleFrames } from "../src/render/options.ts";
import { videoProblems, type VideoProbe } from "../src/render/probe.ts";
import type { Settings } from "../src/schemas/settings.ts";
import { WorkspaceService } from "../src/workspace.ts";
import { makeEmptyRepo, REPO_ROOT } from "./helpers.ts";
import { makePng } from "./media-fixtures.ts";

let settings: Settings;
beforeEach(async () => {
  settings = await loadSettings(REPO_ROOT);
});

const profile = (id: string) => settings.renderProfiles.find((p) => p.id === id)!;

describe("naming", () => {
  it("follows the spec's file naming convention", () => {
    const base = renderBaseName(
      new Date("2026-10-15T09:05:07.123Z"),
      "qr-code-advert",
      "standard",
      "a1b2c3d4e5f6",
    );
    expect(base).toBe("20261015-090507_qr-code-advert_standard_a1b2c3d4");
    expect(outputNames(base)).toEqual({
      video: "20261015-090507_qr-code-advert_standard_a1b2c3d4.mp4",
      poster: "20261015-090507_qr-code-advert_standard_a1b2c3d4-poster.png",
      manifest: "20261015-090507_qr-code-advert_standard_a1b2c3d4.render.json",
    });
    expect(isRenderId(base)).toBe(true);
    expect(isRenderId(`${base}-2`)).toBe(true);
    expect(isRenderId("../../etc")).toBe(false);
    expect(isRenderId(`${base}/..`)).toBe(false);
  });
});

describe("render options", () => {
  it("maps each profile to Remotion's renderMedia options", () => {
    expect(mediaRenderOptions(profile("draft"))).toEqual({
      codec: "h264",
      crf: 28,
      pixelFormat: "yuv420p",
      imageFormat: "jpeg",
      jpegQuality: 90,
      scale: 0.5,
      audioCodec: "aac",
      audioBitrate: "128k",
      concurrency: 4,
      muted: false,
      enforceAudioTrack: false,
      overwrite: false,
    });
    expect(mediaRenderOptions(profile("standard"))).toMatchObject({
      crf: 20,
      scale: 1,
      audioBitrate: "192k",
    });
    const high = mediaRenderOptions(profile("high-quality"));
    expect(high).toMatchObject({ crf: 16, imageFormat: "png" });
    expect(high).not.toHaveProperty("jpegQuality");
  });

  it("computes the scaled output size", () => {
    const format = { width: 1080, height: 1920, fps: 30, durationInFrames: 360 };
    expect(outputSize(format, profile("draft"))).toEqual({ width: 540, height: 960 });
    expect(outputSize(format, profile("standard"))).toEqual({ width: 1080, height: 1920 });
  });

  it("samples the first, quarter, last and poster frames for the smoke test", () => {
    expect(sampleFrames(360, 300)).toEqual([0, 89, 179, 269, 300, 359]);
    expect(sampleFrames(1, 0)).toEqual([0]);
  });
});

describe("canonical JSON and fingerprints", () => {
  const base: FingerprintInputs = {
    production: {
      id: "p",
      compositionId: "c",
      format: { width: 1080, height: 1920, fps: 30, durationInFrames: 360 },
      posterFrame: 300,
    },
    profile: {
      id: "standard",
      name: "Standard",
      container: "mp4",
      codec: "h264",
      pixelFormat: "yuv420p",
      crf: 20,
      audioCodec: "aac",
      audioBitrate: "192k",
      concurrency: 4,
      imageFormat: "jpeg",
      scale: 1,
    },
    props: { url: "https://example.com", nested: { b: 1, a: 2 } },
    source: { "composition.tsx": "a".repeat(64) },
    runtime: { "index.ts": "b".repeat(64) },
    assets: { "brand:logo.png": "c".repeat(64) },
    lockfile: "d".repeat(64),
  };

  it("ignores key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(
      canonicalJson({ a: { c: 2, d: 1 }, b: 1 }),
    );
  });

  it("is stable for identical inputs", () => {
    expect(computeFingerprint(base)).toBe(computeFingerprint(structuredClone(base)));
    expect(computeFingerprint(base)).toMatch(/^[a-f0-9]{64}$/);
  });

  it.each<[string, (inputs: FingerprintInputs) => void]>([
    ["an asset hash", (i) => (i.assets["brand:logo.png"] = "e".repeat(64))],
    ["a source file", (i) => (i.source["scene.tsx"] = "f".repeat(64))],
    ["the shared runtime", (i) => (i.runtime["index.ts"] = "0".repeat(64))],
    ["the props", (i) => (i.props.url = "https://other.example")],
    ["the profile", (i) => (i.profile.crf = 18)],
    ["the duration", (i) => (i.production.format.durationInFrames = 361)],
    ["the poster frame", (i) => (i.production.posterFrame = 10)],
    ["the lockfile", (i) => (i.lockfile = "1".repeat(64))],
  ])("changes when %s changes", (_label, mutate) => {
    const changed = structuredClone(base);
    mutate(changed);
    expect(computeFingerprint(changed)).not.toBe(computeFingerprint(base));
  });

  it("ignores titles and timestamps but tracks assets and source on disk", async () => {
    const { repoRoot, workspaceRoot } = await makeEmptyRepo();
    const workspace = new WorkspaceService({
      repoRoot,
      workspaceRoot,
      settings: await loadSettings(repoRoot),
    });
    const assets = new AssetLibrary(workspace);
    const project = await workspace.createProject({ name: "P" });
    const campaign = await workspace.createCampaign(project.id, { name: "C" });
    const production = await workspace.createProduction(campaign.id, {
      title: "T",
      format: { width: 1080, height: 1920, fps: 30, durationInFrames: 90 },
    });
    const fingerprint = async () =>
      computeFingerprint(
        await gatherFingerprintInputs(workspace, assets, production.id, profile("standard")),
      );

    const first = await fingerprint();
    await workspace.updateProduction(production.id, {
      revision: 1,
      title: "Renamed",
      description: "New words",
      status: "review",
      format: production.format,
      posterFrame: production.posterFrame,
      defaultRenderProfileId: "standard",
      tags: ["x"],
    });
    expect(await fingerprint()).toBe(first);

    await assets.upload("brand", project.id, {
      originalName: "logo.png",
      body: (async function* () {
        yield makePng(4, 4);
      })(),
    });
    const withAsset = await fingerprint();
    expect(withAsset).not.toBe(first);

    const entry = path.join(workspaceRoot, "p/campaigns/c/productions/t/src/composition.tsx");
    await writeFile(entry, `${await readFile(entry, "utf8")}\n// edit\n`);
    expect(await fingerprint()).not.toBe(withAsset);
  });
});

describe("videoProblems", () => {
  const expected = {
    codec: "h264",
    pixelFormat: "yuv420p",
    width: 1080,
    height: 1920,
    fps: 30,
    frames: 360,
  } as const;
  const good: VideoProbe = {
    codec: "h264",
    pixelFormat: "yuv420p",
    width: 1080,
    height: 1920,
    fps: 30,
    frames: 360,
    durationSeconds: 12,
    hasAudio: false,
  };

  it("accepts a matching file", () => {
    expect(videoProblems(expected, good)).toEqual([]);
    expect(videoProblems(expected, { ...good, durationSeconds: 12.02 })).toEqual([]);
  });

  it.each<[Partial<VideoProbe>, string]>([
    [{ codec: "hevc" }, "codec is hevc"],
    [{ pixelFormat: "yuv444p" }, "pixel format is yuv444p"],
    [{ width: 1072 }, "size is 1072×1920"],
    [{ fps: 29.97 }, "frame rate is 29.97"],
    [{ frames: 361 }, "contains 361 frames, expected exactly 360"],
    [{ frames: 359 }, "contains 359 frames"],
    [{ durationSeconds: 12.5 }, "duration is 12.500 s"],
  ])("reports %j", (patch, message) => {
    expect(videoProblems(expected, { ...good, ...patch }).join("; ")).toContain(message);
  });
});

describe("RenderController without rendering", () => {
  async function setUp() {
    const { repoRoot, workspaceRoot } = await makeEmptyRepo();
    const workspace = new WorkspaceService({
      repoRoot,
      workspaceRoot,
      settings: await loadSettings(repoRoot),
    });
    const assets = new AssetLibrary(workspace);
    const project = await workspace.createProject({ name: "P" });
    const campaign = await workspace.createCampaign(project.id, { name: "C" });
    const production = await workspace.createProduction(campaign.id, {
      title: "T",
      format: { width: 1080, height: 1920, fps: 30, durationInFrames: 90 },
    });
    return { workspace, controller: new RenderController(workspace, assets), production };
  }

  it("refuses to start while another live process holds the render lock", async () => {
    const { workspace, controller, production } = await setUp();
    await mkdir(workspace.jobsRoot, { recursive: true });
    await writeFile(
      path.join(workspace.jobsRoot, "active.lock"),
      JSON.stringify({ pid: process.pid, renderId: "other" }),
    );
    await expect(
      controller.start({ productionId: production.id, profileId: "standard" }),
    ).rejects.toMatchObject({
      code: "BUSY",
    });
  });

  it("reclaims a lock left by a dead process and releases it after a failed preflight", async () => {
    const { workspace, controller, production } = await setUp();
    await mkdir(workspace.jobsRoot, { recursive: true });
    const lock = path.join(workspace.jobsRoot, "active.lock");
    await writeFile(lock, JSON.stringify({ pid: 2 ** 22 + 12345, renderId: "ghost" }));
    // Outside the real repo the composition cannot resolve `remotion`, so preflight fails.
    await expect(
      controller.start({ productionId: production.id, profileId: "standard" }),
    ).rejects.toMatchObject({
      code: "PREFLIGHT_FAILED",
    });
    expect(await readdir(workspace.jobsRoot)).toEqual([]);
  });

  it("marks jobs left running as interrupted and removes their partial outputs", async () => {
    const { workspace, controller } = await setUp();
    const jobDir = path.join(workspace.jobsRoot, "20261015-120000_t_standard_abcdef12");
    await mkdir(path.join(jobDir, "bundle"), { recursive: true });
    await writeFile(
      path.join(jobDir, "20261015-120000_t_standard_abcdef12.partial.mp4"),
      "partial",
    );
    await writeFile(path.join(jobDir, "log.txt"), "started\n");
    await writeFile(path.join(jobDir, "request.json"), "{}");
    await writeFile(
      path.join(jobDir, "job.json"),
      JSON.stringify({ renderId: "x", status: "running", pid: 99999 }),
    );

    expect(await controller.recover()).toEqual(["20261015-120000_t_standard_abcdef12"]);
    expect((await readdir(jobDir)).sort()).toEqual(["job.json", "log.txt", "request.json"]);
    const state = JSON.parse(await readFile(path.join(jobDir, "job.json"), "utf8"));
    expect(state).toMatchObject({ status: "interrupted", error: { code: "INTERRUPTED" } });
    expect(state).not.toHaveProperty("pid");
    expect(await controller.recover()).toEqual([]);
  });

  it("rejects malformed render IDs", async () => {
    const { controller } = await setUp();
    await expect(controller.get("../../etc/passwd")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
