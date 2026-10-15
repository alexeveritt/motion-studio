import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { scanCatalog } from "../src/catalog.ts";
import { loadSettings, resolveWorkspaceRoot } from "../src/repo.ts";
import { FIXTURE_WORKSPACE, makeTempRepo, patchJson, REPO_ROOT } from "./helpers.ts";

const CAMPAIGN = "sample-studio/campaigns/launch-teaser";
const PRODUCTION = `${CAMPAIGN}/productions/square-teaser`;

async function scanTemp(mutate: (workspaceRoot: string) => Promise<void>) {
  const { repoRoot, workspaceRoot } = await makeTempRepo();
  await mutate(workspaceRoot);
  return scanCatalog({ repoRoot, workspaceRoot, settings: await loadSettings(repoRoot) });
}

describe("scanCatalog", () => {
  it("builds the fixture hierarchy with no issues", async () => {
    const settings = await loadSettings(REPO_ROOT);
    const catalog = await scanCatalog({
      repoRoot: REPO_ROOT,
      workspaceRoot: FIXTURE_WORKSPACE,
      settings,
    });

    expect(catalog.issues).toEqual([]);
    expect(catalog.workspacePath).toBe("fixtures/workspace/projects");
    expect(catalog.projects).toHaveLength(1);
    const [project] = catalog.projects;
    expect(project?.path).toBe("fixtures/workspace/projects/sample-studio");
    expect(project?.campaigns.map((c) => c.record.slug)).toEqual(["launch-teaser"]);
    expect(project?.campaigns[0]?.productions.map((p) => p.record.slug)).toEqual([
      "square-teaser",
      "vertical-story",
    ]);
  });

  it("treats a missing workspace as empty", async () => {
    const settings = await loadSettings(REPO_ROOT);
    const catalog = await scanCatalog({
      repoRoot: REPO_ROOT,
      workspaceRoot: path.join(tmpdir(), "does-not-exist-ms"),
      settings,
    });
    expect(catalog.projects).toEqual([]);
  });

  it("reports invalid JSON and keeps scanning siblings", async () => {
    const catalog = await scanTemp((ws) =>
      writeFile(path.join(ws, PRODUCTION, "production.json"), "{ nope"),
    );
    expect(catalog.issues).toEqual([
      expect.objectContaining({
        code: "JSON_INVALID",
        path: `workspace/projects/${PRODUCTION}/production.json`,
      }),
    ]);
    expect(catalog.projects[0]?.campaigns[0]?.productions.map((p) => p.record.slug)).toEqual([
      "vertical-story",
    ]);
  });

  it("reports a future schema version", async () => {
    const catalog = await scanTemp((ws) =>
      patchJson(path.join(ws, PRODUCTION, "production.json"), { schemaVersion: 9 }),
    );
    expect(catalog.issues.map((i) => i.code)).toEqual(["SCHEMA_VERSION_UNSUPPORTED"]);
  });

  it("reports slug and parent reference mismatches", async () => {
    const catalog = await scanTemp(async (ws) => {
      await patchJson(path.join(ws, PRODUCTION, "production.json"), {
        slug: "renamed",
        campaignId: "01a13edc-0000-7000-8000-000000000000",
      });
    });
    expect(catalog.issues.map((i) => i.code).sort()).toEqual([
      "REFERENCE_MISMATCH",
      "SLUG_MISMATCH",
    ]);
  });

  it("reports duplicate IDs and composition IDs", async () => {
    const catalog = await scanTemp(async (ws) => {
      await patchJson(path.join(ws, CAMPAIGN, "productions/vertical-story/production.json"), {
        compositionId: "sample-studio-square-teaser",
      });
    });
    expect(catalog.issues).toEqual([
      expect.objectContaining({
        code: "DUPLICATE_ID",
        message: expect.stringContaining("compositionId"),
      }),
    ]);
  });

  it("reports missing records, unsafe names and symlinks without following them", async () => {
    const catalog = await scanTemp(async (ws) => {
      await mkdir(path.join(ws, "empty-project"));
      await mkdir(path.join(ws, "Not A Slug"));
      await mkdir(path.join(ws, ".hidden"));
      await symlink(path.join(ws, "sample-studio"), path.join(ws, "linked-project"));
    });
    expect(catalog.issues.map((i) => [i.code, i.path])).toEqual(
      expect.arrayContaining([
        ["RECORD_MISSING", "workspace/projects/empty-project"],
        ["UNSAFE_ENTRY", "workspace/projects/linked-project"],
        ["SLUG_MISMATCH", "workspace/projects/Not A Slug"],
      ]),
    );
    expect(catalog.issues).toHaveLength(3);
    expect(catalog.projects.map((p) => p.record.slug)).toEqual(["sample-studio"]);
  });

  it("warns about unknown render profiles", async () => {
    const catalog = await scanTemp((ws) =>
      patchJson(path.join(ws, PRODUCTION, "production.json"), { defaultRenderProfileId: "ultra" }),
    );
    expect(catalog.issues).toEqual([
      expect.objectContaining({ severity: "warning", code: "UNKNOWN_RENDER_PROFILE" }),
    ]);
  });
});

describe("resolveWorkspaceRoot", () => {
  it("resolves the configured root inside the repository", async () => {
    const settings = await loadSettings(REPO_ROOT);
    expect(resolveWorkspaceRoot(REPO_ROOT, settings)).toBe(
      path.join(REPO_ROOT, "workspace/projects"),
    );
    expect(resolveWorkspaceRoot(REPO_ROOT, settings, "fixtures/workspace/projects")).toBe(
      FIXTURE_WORKSPACE,
    );
  });

  it.each(["../elsewhere", "/tmp", "fixtures/../../x"])("rejects override %j", async (override) => {
    const settings = await loadSettings(REPO_ROOT);
    expect(() => resolveWorkspaceRoot(REPO_ROOT, settings, override)).toThrow(/repository/);
  });

  it("rejects a symlinked root that escapes the repository", async () => {
    const { repoRoot } = await makeTempRepo();
    await symlink(tmpdir(), path.join(repoRoot, "escape"));
    const settings = await loadSettings(repoRoot);
    expect(() => resolveWorkspaceRoot(repoRoot, settings, "escape")).toThrow(
      /outside the repository/,
    );
  });
});
