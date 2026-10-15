import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AssetLibrary, hashFile } from "../src/assets.ts";
import { loadSettings } from "../src/repo.ts";
import type { Settings } from "../src/schemas/settings.ts";
import { WorkspaceService } from "../src/workspace.ts";
import { listFiles, makeEmptyRepo } from "./helpers.ts";
import { CLEAN_SVG, makePng, PDF } from "./media-fixtures.ts";

let repoRoot: string;
let workspaceRoot: string;
let workspace: WorkspaceService;
let assets: AssetLibrary;
let productionId: string;
let projectId: string;
let productionDir: string;

async function* bytes(...chunks: Buffer[]) {
  for (const chunk of chunks) yield new Uint8Array(chunk);
}

const upload = (name: string, ...chunks: Buffer[]) =>
  assets.upload("production", productionId, { originalName: name, body: bytes(...chunks) });

async function setUp(limits: Partial<Settings["limits"]> = {}) {
  ({ repoRoot, workspaceRoot } = await makeEmptyRepo());
  const settings = await loadSettings(repoRoot);
  workspace = new WorkspaceService({
    repoRoot,
    workspaceRoot,
    settings: { ...settings, limits: { ...settings.limits, ...limits } },
    now: () => new Date("2026-10-15T12:00:00.000Z"),
  });
  assets = new AssetLibrary(workspace);
  const project = await workspace.createProject({ name: "CookGuide" });
  const campaign = await workspace.createCampaign(project.id, { name: "QR" });
  const production = await workspace.createProduction(campaign.id, {
    title: "Advert",
    format: { width: 1080, height: 1920, fps: 30, durationInFrames: 360 },
  });
  projectId = project.id;
  productionId = production.id;
  productionDir = path.join(workspaceRoot, "cookguide/campaigns/qr/productions/advert");
}

const stagingFiles = async () =>
  readdir(path.join(repoRoot, ".motion-studio/tmp/uploads")).catch(() => []);

beforeEach(() => setUp());

describe("upload", () => {
  it("stores the file under a normalised name with a sidecar", async () => {
    const png = makePng(400, 200);
    const entry = await upload("CookGuide Logo (Final).PNG", png);

    expect(entry.record).toMatchObject({
      originalName: "CookGuide Logo (Final).PNG",
      storedName: "cookguide-logo-final.png",
      mediaType: "image",
      mimeType: "image/png",
      bytes: png.length,
      width: 400,
      height: 200,
    });
    expect(entry.status).toBe("ok");
    expect(entry.path).toBe(
      "workspace/projects/cookguide/campaigns/qr/productions/advert/assets/cookguide-logo-final.png",
    );
    expect(await hashFile(path.join(repoRoot, entry.path))).toBe(entry.record.sha256);
    expect(await listFiles(path.join(productionDir, "assets"))).toEqual([
      ".gitkeep",
      "cookguide-logo-final.png",
      "cookguide-logo-final.png.asset.json",
    ]);
    expect(await stagingFiles()).toEqual([]);
  });

  it("streams multi-chunk uploads and hashes the whole body", async () => {
    const png = makePng(64, 64);
    const entry = await upload("split.png", png.subarray(0, 10), png.subarray(10));
    expect(entry.record.sha256).toBe(await hashFile(path.join(repoRoot, entry.path)));
  });

  it("never overwrites: a different file with the same name gets a suffix", async () => {
    const first = await upload("logo.png", makePng(10, 10, [0, 0, 0]));
    const second = await upload("logo.png", makePng(10, 10, [255, 255, 255]));
    expect(first.record.storedName).toBe("logo.png");
    expect(second.record.storedName).toBe(
      `logo-${second.record.id.replaceAll("-", "").slice(-4)}.png`,
    );
    expect(await hashFile(path.join(repoRoot, first.path))).toBe(first.record.sha256);
  });

  it("rejects an identical file uploaded twice", async () => {
    const png = makePng(10, 10);
    await upload("a.png", png);
    await expect(upload("b.png", png)).rejects.toMatchObject({
      code: "ALREADY_EXISTS",
      message: expect.stringContaining("a.png"),
    });
  });

  it.each(["../../../escape.png", "..\\..\\escape.png", "/etc/escape.png", "C:\\temp\\escape.png"])(
    "keeps traversal names %j inside the asset folder",
    async (name) => {
      const entry = await upload(name, makePng(4, 4));
      expect(entry.record.originalName).toBe("escape.png");
      expect(entry.path).toBe(
        "workspace/projects/cookguide/campaigns/qr/productions/advert/assets/escape.png",
      );
      expect(await listFiles(repoRoot)).not.toContain("escape.png");
    },
  );

  it.each(["", "..", "bad\u0000name.png", "line\nbreak.png"])(
    "rejects unusable name %j",
    async (name) => {
      await expect(upload(name, makePng(4, 4))).rejects.toMatchObject({ code: "INVALID_INPUT" });
    },
  );

  it("derives the extension from the content, not the name", async () => {
    const entry = await upload("brochure.png", PDF);
    expect(entry.record).toMatchObject({
      storedName: "brochure.pdf",
      mimeType: "application/pdf",
      mediaType: "document",
    });
  });

  it("rejects disallowed types and cleans up staging", async () => {
    await expect(upload("tool.png", Buffer.from([0x4d, 0x5a, 0x90, 0x00]))).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA",
    });
    expect(await listFiles(path.join(productionDir, "assets"))).toEqual([".gitkeep"]);
    expect(await stagingFiles()).toEqual([]);
  });

  it("accepts a clean SVG and rejects one with script", async () => {
    const clean = await upload("wordmark.svg", Buffer.from(CLEAN_SVG));
    expect(clean.record).toMatchObject({ mimeType: "image/svg+xml", width: 240, height: 80 });
    await expect(
      upload("evil.svg", Buffer.from('<svg onload="alert(1)"></svg>')),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA",
      message: expect.stringContaining("event handler"),
    });
  });

  it("rejects empty files", async () => {
    await expect(upload("empty.png")).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("enforces the upload size limit while streaming", async () => {
    await setUp({ maxUploadBytes: 1000 });
    const png = makePng(200, 200, [1, 2, 3]);
    const noisy = Buffer.concat([png, Buffer.alloc(2000, 7)]);
    await expect(
      upload("big.png", noisy.subarray(0, 600), noisy.subarray(600)),
    ).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(await stagingFiles()).toEqual([]);
    expect(await listFiles(path.join(productionDir, "assets"))).toEqual([".gitkeep"]);
  });

  it("enforces the total project size limit", async () => {
    await setUp({ maxProjectBytes: 8000 });
    await expect(
      upload("big.png", Buffer.concat([makePng(4, 4), Buffer.alloc(9000)])),
    ).rejects.toMatchObject({
      code: "LIMIT_EXCEEDED",
      message: expect.stringContaining("project"),
    });
  });

  it("stores project, brand and campaign assets in their own folders", async () => {
    const brand = await assets.upload("brand", projectId, {
      originalName: "logo.png",
      body: bytes(makePng(8, 8)),
    });
    const shared = await assets.upload("project", projectId, {
      originalName: "logo.png",
      body: bytes(makePng(9, 9)),
    });
    expect(brand.path).toBe("workspace/projects/cookguide/brand/assets/logo.png");
    expect(shared.path).toBe("workspace/projects/cookguide/assets/logo.png");
  });
});

describe("listing and integrity", () => {
  it("reports modified and missing files and unregistered copies", async () => {
    const modified = await upload("a.png", makePng(4, 4, [1, 1, 1]));
    const missing = await upload("b.png", makePng(4, 4, [2, 2, 2]));
    await writeFile(path.join(repoRoot, modified.path), makePng(4, 4, [9, 9, 9]));
    await rm(path.join(repoRoot, missing.path));
    await writeFile(path.join(productionDir, "assets/dropped-in.png"), makePng(4, 4, [3, 3, 3]));

    const listing = await assets.list("production", productionId);
    expect(listing.assets.map((a) => [a.record.storedName, a.status])).toEqual([
      ["a.png", "modified"],
      ["b.png", "missing"],
    ]);
    expect(listing.unregistered.map((u) => u.name)).toEqual(["dropped-in.png"]);

    const issues = await assets.validate(await workspace.scan());
    expect(issues.map((i) => [i.severity, i.path.split("/").pop()])).toEqual([
      ["error", "a.png"],
      ["error", "b.png"],
      ["warning", "dropped-in.png"],
    ]);
  });

  it("ignores symlinks in asset folders", async () => {
    await symlink("/etc/hosts", path.join(productionDir, "assets/hosts.png"));
    const listing = await assets.list("production", productionId);
    expect(listing.unregistered).toEqual([]);
    expect(listing.problems).toEqual([
      expect.objectContaining({ message: "Symbolic links are ignored" }),
    ]);
  });

  it("reports a sidecar that fails validation", async () => {
    await writeFile(path.join(productionDir, "assets/x.png.asset.json"), '{"schemaVersion": 1}');
    const listing = await assets.list("production", productionId);
    expect(listing.problems).toHaveLength(1);
  });
});

describe("register", () => {
  it("creates a sidecar for a file copied in by hand", async () => {
    await writeFile(path.join(productionDir, "assets/phone-ui.png"), makePng(300, 600));
    const entry = await assets.register("production", productionId, { fileName: "phone-ui.png" });
    expect(entry.record).toMatchObject({
      storedName: "phone-ui.png",
      originalName: "phone-ui.png",
      width: 300,
      height: 600,
    });
    expect((await assets.list("production", productionId)).unregistered).toEqual([]);
  });

  it("refuses a file whose extension does not match its content", async () => {
    await writeFile(path.join(productionDir, "assets/report.png"), PDF);
    await expect(
      assets.register("production", productionId, { fileName: "report.png" }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_MEDIA",
      message: expect.stringContaining(".pdf"),
    });
  });

  it.each(["../production.json", "missing.png", ".gitkeep"])("refuses %j", async (fileName) => {
    await expect(assets.register("production", productionId, { fileName })).rejects.toThrow();
  });
});

describe("metadata", () => {
  it("updates fields, removes cleared ones and rejects stale edits", async () => {
    const entry = await upload("food.png", makePng(4, 4));
    const updated = await assets.updateMetadata("production", productionId, entry.record.id, {
      baseHash: entry.sidecarHash,
      altText: "Bowl of ramen",
      source: "Unsplash",
      licenceNotes: "Unsplash licence",
    });
    expect(updated.record).toMatchObject({ altText: "Bowl of ramen", source: "Unsplash" });

    const cleared = await assets.updateMetadata("production", productionId, entry.record.id, {
      baseHash: updated.sidecarHash,
      source: "",
    });
    expect(cleared.record).not.toHaveProperty("source");
    expect(cleared.record.altText).toBe("Bowl of ramen");

    await expect(
      assets.updateMetadata("production", productionId, entry.record.id, {
        baseHash: entry.sidecarHash,
        altText: "stale",
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });
});

describe("usage and archive", () => {
  it("reports usage from production source and refuses to archive used assets", async () => {
    const entry = await upload("logo.png", makePng(4, 4));
    await writeFile(
      path.join(productionDir, "src/composition.tsx"),
      'const logo = staticFile("assets/logo.png");\n',
    );

    const listing = await assets.list("production", productionId);
    expect(listing.assets[0]?.usage).toEqual([
      "workspace/projects/cookguide/campaigns/qr/productions/advert/src/composition.tsx",
    ]);

    await expect(
      assets.archive("production", productionId, entry.record.id, { confirmName: "logo.png" }),
    ).rejects.toMatchObject({ code: "IN_USE" });

    await writeFile(path.join(productionDir, "src/composition.tsx"), "export {};\n");
    await expect(
      assets.archive("production", productionId, entry.record.id, { confirmName: "nope" }),
    ).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED",
    });
    const { archivedPath } = await assets.archive("production", productionId, entry.record.id, {
      confirmName: "logo.png",
    });
    expect(await listFiles(path.join(repoRoot, archivedPath))).toEqual([
      "archive.json",
      "logo.png",
      "logo.png.asset.json",
    ]);
    expect((await assets.list("production", productionId)).assets).toEqual([]);
  });

  it("counts project asset usage across every production in the project", async () => {
    await assets.upload("brand", projectId, {
      originalName: "wordmark.svg",
      body: bytes(Buffer.from(CLEAN_SVG)),
    });
    await mkdir(path.join(productionDir, "src/scenes"), { recursive: true });
    await writeFile(
      path.join(productionDir, "src/scenes/end.tsx"),
      "// uses brand/assets/wordmark.svg\n",
    );
    const listing = await assets.list("brand", projectId);
    expect(listing.assets[0]?.usage).toEqual([
      "workspace/projects/cookguide/campaigns/qr/productions/advert/src/scenes/end.tsx",
    ]);
  });

  it("opens assets by ID only", async () => {
    const entry = await upload("logo.png", makePng(4, 4));
    const opened = await assets.open("production", productionId, entry.record.id);
    expect(await readFile(opened.file)).toEqual(await readFile(path.join(repoRoot, entry.path)));
    await expect(
      assets.open("production", productionId, "01a13edc-0000-7000-8000-000000000000"),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
