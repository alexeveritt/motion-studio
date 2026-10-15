import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AssetLibrary, hashFile } from "../src/assets.ts";
import { serializeJson } from "../src/fs-store.ts";
import { RenderApprovals } from "../src/render/approval.ts";
import { RenderController } from "../src/render/controller.ts";
import { computeFingerprint, gatherFingerprintInputs } from "../src/render/fingerprint.ts";
import { loadSettings } from "../src/repo.ts";
import type { RenderManifest } from "../src/schemas/render-manifest.ts";
import { hashContent, WorkspaceService } from "../src/workspace.ts";
import { listFiles, makeEmptyRepo, readJson } from "./helpers.ts";

/**
 * Approval logic only needs manifests and output files, so these tests write
 * them directly instead of rendering.
 */
let workspace: WorkspaceService;
let assets: AssetLibrary;
let approvals: RenderApprovals;
let productionId: string;
let dir: string;
let fingerprint: string;

const EMPTY = hashContent("");
const approvalFile = () => path.join(dir, "renders/approved.json");

async function fakeRender(renderId: string, bytes: string): Promise<RenderManifest> {
  const video = path.join(dir, "renders/final", `${renderId}.mp4`);
  const poster = path.join(dir, "renders/final", `${renderId}-poster.png`);
  await mkdir(path.dirname(video), { recursive: true });
  await mkdir(path.join(dir, "renders/manifests"), { recursive: true });
  await writeFile(video, bytes);
  await writeFile(poster, `poster ${bytes}`);
  const manifest: RenderManifest = {
    schemaVersion: 1,
    renderId,
    productionId,
    compositionId: "clip",
    profileId: "standard",
    requestedAt: "2026-10-15T12:00:00.000Z",
    startedAt: "2026-10-15T12:00:01.000Z",
    completedAt: `2026-10-15T12:00:0${renderId.endsWith("a") ? 2 : 3}.000Z`,
    status: "succeeded",
    inputFingerprint: fingerprint,
    environment: {
      node: "24.11.0",
      pnpm: "11.25.0",
      remotion: "4.0.535",
      platform: "darwin",
      architecture: "arm64",
    },
    video: {
      relativePath: `renders/final/${renderId}.mp4`,
      sha256: await hashFile(video),
      bytes: bytes.length,
      width: 240,
      height: 320,
      fps: 30,
      durationInFrames: 30,
      durationSeconds: 1,
      codec: "h264",
      pixelFormat: "yuv420p",
    },
    poster: {
      relativePath: `renders/final/${renderId}-poster.png`,
      frame: 20,
      sha256: await hashFile(poster),
    },
    warnings: [],
  };
  await writeFile(
    path.join(dir, "renders/manifests", `${renderId}.render.json`),
    serializeJson(manifest),
  );
  return manifest;
}

const RENDER_A = "20261015-120000_clip_standard_aaaaaaaa";
const RENDER_B = "20261015-120100_clip_standard_bbbbbbbb";

beforeEach(async () => {
  const { repoRoot } = await makeEmptyRepo();
  // Under a dot folder, like the browser tests' workspace, so path handling cannot rely on the repo root.
  const workspaceRoot = path.join(repoRoot, ".motion-studio/tmp/projects");
  await mkdir(workspaceRoot, { recursive: true });
  workspace = new WorkspaceService({
    repoRoot,
    workspaceRoot,
    settings: await loadSettings(repoRoot),
    now: () => new Date("2026-10-15T13:00:00.000Z"),
  });
  assets = new AssetLibrary(workspace);
  approvals = new RenderApprovals(workspace, assets, new RenderController(workspace, assets));
  const project = await workspace.createProject({ name: "Approve" });
  const campaign = await workspace.createCampaign(project.id, { name: "Tests" });
  const production = await workspace.createProduction(campaign.id, {
    title: "Clip",
    format: { width: 240, height: 320, fps: 30, durationInFrames: 30 },
    posterFrame: 20,
  });
  productionId = production.id;
  dir = path.join(workspaceRoot, "approve/campaigns/tests/productions/clip");
  const profile = workspace.settings.renderProfiles.find((p) => p.id === "standard")!;
  fingerprint = computeFingerprint(
    await gatherFingerprintInputs(workspace, assets, productionId, profile),
  );
  await fakeRender(RENDER_A, "video a");
  await fakeRender(RENDER_B, "video b");
});

describe("render approval", () => {
  it("starts with nothing approved", async () => {
    const status = await approvals.status(productionId);
    expect(status).toMatchObject({ state: "none", hash: EMPTY, problems: [] });
    expect(status.path).toBe(
      ".motion-studio/tmp/projects/approve/campaigns/tests/productions/clip/renders/approved.json",
    );
  });

  it("approves a render, pinning its manifest, video and poster hashes", async () => {
    const status = await approvals.approve(productionId, {
      renderId: RENDER_A,
      baseHash: EMPTY,
      note: "  Approved by the owner for Instagram  ",
    });
    expect(status.state).toBe("current");
    expect(status.currentFingerprint).toBe(fingerprint);
    const saved = await readJson(approvalFile());
    expect(saved).toEqual({
      schemaVersion: 1,
      productionId,
      renderId: RENDER_A,
      profileId: "standard",
      inputFingerprint: fingerprint,
      manifest: {
        relativePath: `renders/manifests/${RENDER_A}.render.json`,
        sha256: await hashFile(path.join(dir, `renders/manifests/${RENDER_A}.render.json`)),
      },
      video: {
        relativePath: `renders/final/${RENDER_A}.mp4`,
        sha256: await hashFile(path.join(dir, `renders/final/${RENDER_A}.mp4`)),
      },
      poster: {
        relativePath: `renders/final/${RENDER_A}-poster.png`,
        sha256: await hashFile(path.join(dir, `renders/final/${RENDER_A}-poster.png`)),
      },
      approvedAt: "2026-10-15T13:00:00.000Z",
      note: "Approved by the owner for Instagram",
    });
    expect(status.hash).toBe(hashContent(await readFile(approvalFile(), "utf8")));
  });

  it("replaces an approval and withdraws one without touching the renders", async () => {
    const first = await approvals.approve(productionId, { renderId: RENDER_A, baseHash: EMPTY });
    const second = await approvals.approve(productionId, {
      renderId: RENDER_B,
      baseHash: first.hash,
    });
    expect(second.approval?.renderId).toBe(RENDER_B);
    const before = await listFiles(path.join(dir, "renders"));
    const removed = await approvals.remove(productionId, { baseHash: second.hash });
    expect(removed.state).toBe("none");
    expect(await listFiles(path.join(dir, "renders"))).toEqual(
      before.filter((file) => file !== "approved.json"),
    );
  });

  it("rejects a change based on a stale approval", async () => {
    await approvals.approve(productionId, { renderId: RENDER_A, baseHash: EMPTY });
    await expect(
      approvals.approve(productionId, { renderId: RENDER_B, baseHash: EMPTY }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(approvals.remove(productionId, { baseHash: EMPTY })).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
    expect((await readJson(approvalFile())).renderId).toBe(RENDER_A);
  });

  it("only approves existing, intact video renders", async () => {
    await expect(
      approvals.approve(productionId, {
        renderId: "20261015-120200_clip_standard_cccccccc",
        baseHash: EMPTY,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await writeFile(path.join(dir, `renders/final/${RENDER_A}.mp4`), "edited");
    await expect(
      approvals.approve(productionId, { renderId: RENDER_A, baseHash: EMPTY }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT", message: /changed after rendering/ });
    await expect(
      approvals.approve(productionId, { renderId: RENDER_B, baseHash: "x" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("reports outdated when the production's inputs change after approval", async () => {
    const { hash } = await approvals.approve(productionId, {
      renderId: RENDER_A,
      baseHash: EMPTY,
    });
    const entry = path.join(dir, "src/composition.tsx");
    const original = await readFile(entry, "utf8");
    await writeFile(entry, `${original}\n// changed\n`);
    const outdated = await approvals.status(productionId);
    expect(outdated.state).toBe("outdated");
    expect(outdated.problems[0]).toMatch(/changed since this render/);
    expect(outdated.hash).toBe(hash);
    await writeFile(entry, original);
    expect((await approvals.status(productionId)).state).toBe("current");
  });

  it("reports broken when an approved file changes or disappears", async () => {
    await approvals.approve(productionId, { renderId: RENDER_A, baseHash: EMPTY });
    const video = path.join(dir, `renders/final/${RENDER_A}.mp4`);
    await writeFile(video, "tampered");
    expect(await approvals.status(productionId)).toMatchObject({
      state: "broken",
      problems: [`The video renders/final/${RENDER_A}.mp4 changed after rendering`],
    });
    await rm(video);
    expect((await approvals.status(productionId)).problems).toEqual([
      `The video renders/final/${RENDER_A}.mp4 is missing`,
    ]);
    await writeFile(video, "video a");
    expect((await approvals.status(productionId)).state).toBe("current");

    const manifest = path.join(dir, `renders/manifests/${RENDER_A}.render.json`);
    await writeFile(
      manifest,
      (await readFile(manifest, "utf8")).replace('"warnings": []', '"warnings": ["x"]'),
    );
    expect((await approvals.status(productionId)).problems).toEqual([
      `The manifest renders/manifests/${RENDER_A}.render.json changed after approval`,
    ]);
  });

  it("reports broken for an invalid approved.json, and still lets it be withdrawn", async () => {
    await writeFile(approvalFile(), "{ not json");
    const invalid = await approvals.status(productionId);
    expect(invalid).toMatchObject({ state: "broken" });
    expect(invalid.problems[0]).toMatch(/not valid JSON/);

    await writeFile(approvalFile(), serializeJson({ schemaVersion: 1, renderId: RENDER_A }));
    const incomplete = await approvals.status(productionId);
    expect(incomplete.state).toBe("broken");
    expect(incomplete.problems.some((p) => p.includes("productionId"))).toBe(true);

    expect((await approvals.remove(productionId, { baseHash: incomplete.hash })).state).toBe(
      "none",
    );
  });

  it("refuses an approval file that points outside the production", async () => {
    const { hash } = await approvals.approve(productionId, {
      renderId: RENDER_A,
      baseHash: EMPTY,
    });
    expect(hash).not.toBe(EMPTY);
    const saved = await readJson(approvalFile());
    await writeFile(
      approvalFile(),
      serializeJson({ ...saved, manifest: { relativePath: "../../../x.json", sha256: EMPTY } }),
    );
    expect((await approvals.status(productionId)).problems).toEqual([
      "Manifest path ../../../x.json is not allowed",
    ]);
  });
});
