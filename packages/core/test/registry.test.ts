import { readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AssetLibrary } from "../src/assets.ts";
import { registryFile, writeRegistry } from "../src/registry.ts";
import { loadSettings } from "../src/repo.ts";
import type { ProductionRecord } from "../src/schemas/production.ts";
import { WorkspaceService } from "../src/workspace.ts";
import { makeEmptyRepo } from "./helpers.ts";
import { makePng } from "./media-fixtures.ts";

let repoRoot: string;
let workspaceRoot: string;
let workspace: WorkspaceService;
let production: ProductionRecord;
const productionDir = () => path.join(workspaceRoot, "cookguide/campaigns/qr/productions/advert");

beforeEach(async () => {
  ({ repoRoot, workspaceRoot } = await makeEmptyRepo());
  workspace = new WorkspaceService({
    repoRoot,
    workspaceRoot,
    settings: await loadSettings(repoRoot),
  });
  const project = await workspace.createProject({ name: "CookGuide" });
  const campaign = await workspace.createCampaign(project.id, { name: "QR" });
  production = await workspace.createProduction(campaign.id, {
    title: "Advert",
    format: { width: 1080, height: 1920, fps: 30, durationInFrames: 360 },
  });
});

describe("placeholder composition", () => {
  it("is scaffolded with the production's composition ID and title", async () => {
    const source = await readFile(path.join(productionDir(), "src/composition.tsx"), "utf8");
    expect(source).toContain('id: "cookguide-advert"');
    expect(source).toContain('defaultProps: { headline: "Advert" }');
    expect(source).toContain("export const composition: MotionStudioComposition<Props>");
    expect(source).not.toMatch(/Math\.random|Date\.now|new Date|fetch\(/);
  });

  it("can be recreated for a production without one, but never overwrites", async () => {
    await expect(workspace.createPlaceholderComposition(production.id)).rejects.toMatchObject({
      code: "ALREADY_EXISTS",
    });
    await rm(path.join(productionDir(), "src"), { recursive: true });
    const { path: created } = await workspace.createPlaceholderComposition(production.id);
    expect(created).toBe(
      "workspace/projects/cookguide/campaigns/qr/productions/advert/src/composition.tsx",
    );
  });
});

describe("writeRegistry", () => {
  it("maps composition IDs to static imports of existing entry files", async () => {
    const result = await writeRegistry(workspace);
    expect(result.file).toBe(
      path.join(repoRoot, ".motion-studio/cache/registry/workspace-projects.ts"),
    );
    expect(result.entries).toEqual({
      "cookguide-advert":
        "workspace/projects/cookguide/campaigns/qr/productions/advert/src/composition.tsx",
    });
    const source = await readFile(result.file, "utf8");
    expect(source).toContain(
      'load: () => import("../../../workspace/projects/cookguide/campaigns/qr/productions/advert/src/composition.tsx"),',
    );
    expect(source).toContain(`productionId: "${production.id}"`);
  });

  it("only rewrites the file when the content changes", async () => {
    expect((await writeRegistry(workspace)).changed).toBe(true);
    expect((await writeRegistry(workspace)).changed).toBe(false);
    await rm(path.join(productionDir(), "src/composition.tsx"));
    const result = await writeRegistry(workspace);
    expect(result.changed).toBe(true);
    expect(result.entries).toEqual({});
  });

  it("skips entry files that are symlinks", async () => {
    await rm(path.join(productionDir(), "src/composition.tsx"));
    await writeFile(path.join(repoRoot, "elsewhere.tsx"), "export {};");
    await symlink(
      path.join(repoRoot, "elsewhere.tsx"),
      path.join(productionDir(), "src/composition.tsx"),
    );
    await expect(writeRegistry(workspace)).rejects.toMatchObject({ code: "UNSAFE_PATH" });
  });

  it("keeps one registry per workspace root", () => {
    expect(registryFile(workspace)).toMatch(/registry\/workspace-projects\.ts$/);
  });
});

describe("readProductionProps", () => {
  it("returns empty props when props.json is absent", async () => {
    expect(await workspace.readProductionProps(production.id)).toMatchObject({
      exists: false,
      props: {},
    });
  });

  it("reads a JSON object and reports invalid content without throwing", async () => {
    const file = path.join(productionDir(), "props.json");
    await writeFile(file, JSON.stringify({ qrUrl: "https://cookguide.example/scan" }));
    expect(await workspace.readProductionProps(production.id)).toMatchObject({
      exists: true,
      props: { qrUrl: "https://cookguide.example/scan" },
    });
    await writeFile(file, "[1, 2]");
    expect((await workspace.readProductionProps(production.id)).error).toBe(
      "props.json must contain a JSON object",
    );
    await writeFile(file, "{ nope");
    expect((await workspace.readProductionProps(production.id)).error).toBe(
      "props.json is not valid JSON",
    );
  });
});

describe("openForProduction", () => {
  it("resolves scoped asset references along the production's chain", async () => {
    const assets = new AssetLibrary(workspace);
    const project = (await workspace.scan()).projects[0]!;
    await assets.upload("brand", project.record.id, {
      originalName: "logo.png",
      body: (async function* () {
        yield makePng(4, 4);
      })(),
    });
    const opened = await assets.openForProduction(production.id, "brand", "logo.png");
    expect(opened.file).toBe(path.join(workspaceRoot, "cookguide/brand/assets/logo.png"));
  });

  it.each([
    ["production", "logo.png"],
    ["brand", "../project.json"],
    ["brand", ".gitkeep"],
  ] as const)("refuses %s:%s", async (scope, name) => {
    const assets = new AssetLibrary(workspace);
    await expect(assets.openForProduction(production.id, scope, name)).rejects.toThrow();
  });

  it("refuses unregistered files even if present", async () => {
    const assets = new AssetLibrary(workspace);
    await writeFile(path.join(productionDir(), "assets/sneaky.png"), makePng(2, 2));
    await expect(
      assets.openForProduction(production.id, "production", "sneaky.png"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
