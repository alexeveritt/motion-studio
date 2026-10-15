import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AssetLibrary, hashFile } from "../src/assets.ts";
import { loadSettings } from "../src/repo.ts";
import { runGolden } from "../src/golden.ts";
import { PreflightFailedError, RenderController } from "../src/render/controller.ts";
import { probeImage, probeVideo } from "../src/render/probe.ts";
import { posterManifestSchema, renderManifestSchema } from "../src/schemas/render-manifest.ts";
import type { ProductionRecord } from "../src/schemas/production.ts";
import { WorkspaceService } from "../src/workspace.ts";
import { REPO_ROOT } from "./helpers.ts";
import { makePng } from "./media-fixtures.ts";

/**
 * Real renders through the worker, Remotion and ffprobe. Runs inside the
 * repository so compositions resolve their packages. Slow by nature.
 */
const scratch = path.join(
  REPO_ROOT,
  ".motion-studio/tmp",
  `vitest-render-${randomBytes(4).toString("hex")}`,
);
const TIMEOUT = 240_000;
let workspace: WorkspaceService;
let assets: AssetLibrary;
let controller: RenderController;
let production: ProductionRecord;
let long: ProductionRecord;
let projectId: string;
let dir: string;

const entryFile = () => path.join(dir, "src/composition.tsx");
const finals = async () =>
  (await readdir(path.join(dir, "renders/final")).catch(() => [])).filter(
    (f) => !f.startsWith("."),
  );
const manifests = async () =>
  (await readdir(path.join(dir, "renders/manifests")).catch(() => [])).filter(
    (f) => !f.startsWith("."),
  );

async function render(productionId = production.id, profileId = "standard") {
  const job = await controller.start({ productionId, profileId });
  return controller.wait(job.renderId);
}

beforeAll(async () => {
  await mkdir(path.join(scratch, "projects"), { recursive: true });
  workspace = new WorkspaceService({
    repoRoot: REPO_ROOT,
    workspaceRoot: path.join(scratch, "projects"),
    jobsRoot: path.join(scratch, "jobs"),
    settings: await loadSettings(REPO_ROOT),
  });
  assets = new AssetLibrary(workspace);
  controller = new RenderController(workspace, assets);
  const project = await workspace.createProject({ name: "Render" });
  projectId = project.id;
  const campaign = await workspace.createCampaign(project.id, { name: "Tests" });
  production = await workspace.createProduction(campaign.id, {
    title: "Clip",
    format: { width: 240, height: 320, fps: 30, durationInFrames: 30 },
    posterFrame: 20,
  });
  long = await workspace.createProduction(campaign.id, {
    title: "Long",
    format: { width: 720, height: 1280, fps: 30, durationInFrames: 1800 },
  });
  dir = path.join(scratch, "projects/render/campaigns/tests/productions/clip");
  await assets.upload("production", production.id, {
    originalName: "swatch.png",
    body: (async function* () {
      yield makePng(40, 40, [255, 0, 0]);
    })(),
  });
  await writeFile(
    entryFile(),
    `import { useAsset, type MotionStudioComposition } from "@motion-studio/motion-runtime";
import { AbsoluteFill, Img, useCurrentFrame } from "remotion";

function Clip({ label }: { label: string }) {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#202020", color: "white", fontSize: 24 }}>
      <Img src={useAsset("production:swatch.png")} style={{ width: 40, height: 40 }} />
      <div>{label} {frame}</div>
    </AbsoluteFill>
  );
}

export const composition: MotionStudioComposition<{ label: string }> = {
  id: "render-clip",
  Component: Clip,
  defaultProps: { label: "frame" },
};
`,
  );
  await writeFile(path.join(dir, "props.json"), JSON.stringify({ label: "props" }));
}, TIMEOUT);

afterAll(() => rm(scratch, { recursive: true, force: true }));

describe("rendering", () => {
  let firstFingerprint: string;
  let firstVideo: string;

  it(
    "passes preflight for a valid production",
    async () => {
      const result = await controller.preflight(production.id, "standard");
      expect(result.checks.filter((c) => c.status === "fail")).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.output).toEqual({ width: 240, height: 320, fps: 30, durationInFrames: 30 });
    },
    TIMEOUT,
  );

  it(
    "renders a validated H.264 MP4, a poster and a manifest",
    async () => {
      const state = await render();
      expect(state.error).toBeUndefined();
      expect(state.status).toBe("succeeded");

      const [manifestName] = await manifests();
      const manifest = renderManifestSchema.parse(
        JSON.parse(await readFile(path.join(dir, "renders/manifests", manifestName!), "utf8")),
      );
      expect(manifest).toMatchObject({
        status: "succeeded",
        profileId: "standard",
        inputFingerprint: state.fingerprint,
        video: {
          width: 240,
          height: 320,
          fps: 30,
          durationInFrames: 30,
          codec: "h264",
          pixelFormat: "yuv420p",
        },
        poster: { frame: 20 },
      });
      expect(manifest.environment.remotion).toBe("4.0.535");

      const video = path.join(dir, manifest.video.relativePath);
      const poster = path.join(dir, manifest.poster!.relativePath);
      expect(await hashFile(video)).toBe(manifest.video.sha256);
      expect(await hashFile(poster)).toBe(manifest.poster!.sha256);
      expect(await probeVideo(video)).toMatchObject({
        frames: 30,
        codec: "h264",
        pixelFormat: "yuv420p",
      });
      expect(await probeImage(poster)).toEqual({ codec: "png", width: 240, height: 320 });

      // The job folder keeps only diagnostics.
      expect((await readdir(path.join(workspace.jobsRoot, state.renderId))).sort()).toEqual([
        "job.json",
        "log.txt",
        "request.json",
      ]);
      firstFingerprint = state.fingerprint;
      firstVideo = video;
    },
    TIMEOUT,
  );

  it(
    "keeps the fingerprint for unchanged inputs and never overwrites earlier outputs",
    async () => {
      const state = await render();
      expect(state.status).toBe("succeeded");
      expect(state.fingerprint).toBe(firstFingerprint);
      expect(await finals()).toHaveLength(4);
      expect(await manifests()).toHaveLength(2);
    },
    TIMEOUT,
  );

  it(
    "changes the fingerprint when a referenced asset changes and leaves the old render intact",
    async () => {
      const before = await hashFile(firstVideo);
      await assets.upload("brand", projectId, {
        originalName: "extra.png",
        body: (async function* () {
          yield makePng(8, 8, [0, 255, 0]);
        })(),
      });
      const result = await controller.preflight(production.id, "standard");
      expect(result.fingerprint).not.toBe(firstFingerprint);
      expect(await hashFile(firstVideo)).toBe(before);
    },
    TIMEOUT,
  );

  it(
    "renders a standalone poster at a chosen frame",
    async () => {
      const job = await controller.start({
        productionId: production.id,
        profileId: "draft",
        kind: "poster",
        frame: 5,
      });
      const state = await controller.wait(job.renderId);
      expect(state.status).toBe("succeeded");
      const manifestName = (await manifests()).find((name) => name.endsWith(".poster.json"))!;
      const manifest = posterManifestSchema.parse(
        JSON.parse(await readFile(path.join(dir, "renders/manifests", manifestName), "utf8")),
      );
      expect(manifest.poster).toMatchObject({ frame: 5, width: 120, height: 160 });
      expect(manifestName).toMatch(/_draft_[0-9a-f]{8}-poster-f5\.poster\.json$/);
    },
    TIMEOUT,
  );

  it(
    "lists successful outputs newest first",
    async () => {
      const history = await controller.history(production.id);
      expect(history.outputs.map((o) => o.kind)).toEqual(["poster", "render", "render"]);
      expect(history.problems).toEqual([]);
    },
    TIMEOUT,
  );
});

describe("golden frames", () => {
  it(
    "records baselines, passes unchanged output and catches a visible change",
    async () => {
      await mkdir(path.join(dir, "tests"), { recursive: true });
      await writeFile(path.join(dir, "tests/golden.json"), JSON.stringify({ frames: [0, 15, 29] }));

      const updated = await runGolden(workspace, controller, production.id, { update: true });
      expect(updated.frames.map((f) => f.status)).toEqual(["updated", "updated", "updated"]);
      expect((await readdir(path.join(dir, "tests/golden"))).sort()).toEqual([
        "frame-0.png",
        "frame-15.png",
        "frame-29.png",
      ]);

      const same = await runGolden(workspace, controller, production.id);
      expect(same.ok).toBe(true);
      expect(same.frames.map((f) => f.status)).toEqual(["pass", "pass", "pass"]);

      const original = await readFile(entryFile(), "utf8");
      await writeFile(
        entryFile(),
        original.replace('background: "#202020"', 'background: "#2060c0"'),
      );
      try {
        const changed = await runGolden(workspace, controller, production.id);
        expect(changed.ok).toBe(false);
        expect(changed.frames.every((f) => f.status === "fail" && f.diff)).toBe(true);
        expect(changed.frames[0]!.comparison!.differentRatio).toBeGreaterThan(0.5);
      } finally {
        await writeFile(entryFile(), original);
      }
    },
    TIMEOUT,
  );
});

describe("failures", () => {
  it(
    "blocks a render when a registered asset is missing",
    async () => {
      const asset = path.join(dir, "assets/swatch.png");
      await rename(asset, `${asset}.moved`);
      try {
        const error = await controller
          .start({ productionId: production.id, profileId: "standard" })
          .catch((e: unknown) => e);
        expect(error).toBeInstanceOf(PreflightFailedError);
        const check = (error as PreflightFailedError).result.checks.find((c) => c.id === "assets");
        expect(check).toMatchObject({
          status: "fail",
          messages: expect.arrayContaining([expect.stringContaining("swatch.png is missing")]),
        });
      } finally {
        await rename(`${asset}.moved`, asset);
      }
    },
    TIMEOUT,
  );

  it(
    "fails at the sample-frame check when the composition throws, without producing outputs",
    async () => {
      const original = await readFile(entryFile(), "utf8");
      const before = await manifests();
      await writeFile(
        entryFile(),
        `import type { MotionStudioComposition } from "@motion-studio/motion-runtime";
import { useCurrentFrame } from "remotion";

function Broken() {
  const frame = useCurrentFrame();
  if (frame >= 20) throw new Error("Scene not finished");
  return <div>{frame}</div>;
}

export const composition: MotionStudioComposition = { id: "render-clip", Component: Broken, defaultProps: {} };
`,
      );
      try {
        const state = await render();
        expect(state.status).toBe("failed");
        expect(state.error?.code).toBe("COMPOSITION_RUNTIME_ERROR");
        expect(state.error?.message).toContain("Scene not finished");
        expect(await manifests()).toEqual(before);
        expect((await readdir(path.join(workspace.jobsRoot, state.renderId))).sort()).toEqual([
          "job.json",
          "log.txt",
          "request.json",
        ]);
      } finally {
        await writeFile(entryFile(), original);
      }
    },
    TIMEOUT,
  );

  it(
    "cancels a running render, rejects a second one meanwhile, and leaves no partial output",
    async () => {
      const job = await controller.start({ productionId: long.id, profileId: "standard" });
      await expect(
        controller.start({ productionId: production.id, profileId: "standard" }),
      ).rejects.toMatchObject({ code: "BUSY" });

      await expect
        .poll(async () => (await controller.get(job.renderId)).state.renderedFrames ?? 0, {
          timeout: 120_000,
          interval: 500,
        })
        .toBeGreaterThan(0);
      await controller.cancel(job.renderId);
      const state = await controller.wait(job.renderId);

      expect(state.status).toBe("cancelled");
      const longDir = path.join(scratch, "projects/render/campaigns/tests/productions/long");
      expect(
        (await readdir(path.join(longDir, "renders/final"))).filter((f) => !f.startsWith(".")),
      ).toEqual([]);
      expect(
        (await readdir(path.join(longDir, "renders/manifests"))).filter((f) => !f.startsWith(".")),
      ).toEqual([]);
      expect((await readdir(path.join(workspace.jobsRoot, state.renderId))).sort()).toEqual([
        "job.json",
        "log.txt",
        "request.json",
      ]);
      expect(await readdir(workspace.jobsRoot)).not.toContain("active.lock");
    },
    TIMEOUT,
  );
});
