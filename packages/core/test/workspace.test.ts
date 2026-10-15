import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { loadSettings } from "../src/repo.ts";
import { productionRecordSchema } from "../src/schemas/production.ts";
import { hashContent, slugCandidates, WorkspaceService } from "../src/workspace.ts";
import { listFiles, makeEmptyRepo, readJson } from "./helpers.ts";

const FIXED_NOW = new Date("2026-10-15T12:00:00.000Z");
const PORTRAIT = { width: 1080, height: 1920, fps: 30, durationInFrames: 360 };

let repoRoot: string;
let workspaceRoot: string;
let service: WorkspaceService;

async function makeService() {
  return new WorkspaceService({
    repoRoot,
    workspaceRoot,
    settings: await loadSettings(repoRoot),
    now: () => FIXED_NOW,
  });
}

async function createHierarchy() {
  const project = await service.createProject({
    name: "CookGuide",
    description: "Recipe guidance",
  });
  const campaign = await service.createCampaign(project.id, {
    name: "QR Awareness",
    objective: "Drive scans",
  });
  const production = await service.createProduction(campaign.id, {
    title: "CookGuide QR Code Advert",
    format: PORTRAIT,
    posterFrame: 300,
  });
  return { project, campaign, production };
}

beforeEach(async () => {
  ({ repoRoot, workspaceRoot } = await makeEmptyRepo());
  service = await makeService();
});

describe("creation", () => {
  it("creates the full hierarchy with the exact scaffold", async () => {
    const { project, campaign, production } = await createHierarchy();

    expect(project).toMatchObject({
      slug: "cookguide",
      revision: 1,
      status: "active",
      defaultRenderProfileId: "standard",
    });
    expect(campaign).toMatchObject({
      slug: "qr-awareness",
      projectId: project.id,
      status: "draft",
    });
    expect(production).toMatchObject({
      slug: "cookguide-qr-code-advert",
      compositionId: "cookguide-cookguide-qr-code-advert",
      projectId: project.id,
      campaignId: campaign.id,
      status: "idea",
      posterFrame: 300,
      format: PORTRAIT,
      createdAt: FIXED_NOW.toISOString(),
    });

    expect(await listFiles(workspaceRoot)).toEqual([
      "cookguide/assets/.gitkeep",
      "cookguide/brand/assets/.gitkeep",
      "cookguide/brand/brand.md",
      "cookguide/campaigns/.gitkeep",
      "cookguide/campaigns/qr-awareness/assets/.gitkeep",
      "cookguide/campaigns/qr-awareness/brief.md",
      "cookguide/campaigns/qr-awareness/campaign.json",
      "cookguide/campaigns/qr-awareness/productions/.gitkeep",
      "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert/assets/.gitkeep",
      "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert/brief.md",
      "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert/notes.md",
      "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert/production.json",
      "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert/prompt.md",
      "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert/props.schema.json",
      "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert/renders/final/.gitkeep",
      "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert/renders/manifests/.gitkeep",
      "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert/src/composition.tsx",
      "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert/tests/.gitkeep",
      "cookguide/context.md",
      "cookguide/project.json",
    ]);
  });

  it("writes a brief with every required section from the spec", async () => {
    const { production } = await createHierarchy();
    const brief = await service.readDocument("production", production.id, "brief");
    const headings = brief.content.split("\n").filter((line) => line.startsWith("## "));
    expect(headings).toEqual([
      "## Objective",
      "## Audience",
      "## Single key message",
      "## Call to action",
      "## Format and duration",
      "## Narrative and scenes",
      "## Required content",
      "## Prohibited content",
      "## Visual direction",
      "## Audio direction",
      "## Accessibility",
      "## Deliverables",
      "## Acceptance criteria",
    ]);
    expect(brief.content).toContain("1080 × 1920, 30 fps, 360 frames (12s)");
  });

  it("survives a restart: a fresh service rebuilds the same catalog from disk", async () => {
    const { production } = await createHierarchy();
    const catalog = await (await makeService()).scan();
    expect(catalog.issues).toEqual([]);
    expect(catalog.projects[0]?.campaigns[0]?.productions[0]?.record).toEqual(production);
  });

  it("resolves slug collisions with a stable suffix instead of overwriting", async () => {
    const first = await service.createProject({ name: "CookGuide" });
    const second = await service.createProject({ name: "CookGuide" });
    expect(first.slug).toBe("cookguide");
    expect(second.slug).toBe(`cookguide-${second.id.replaceAll("-", "").slice(-4)}`);
    expect((await readJson(path.join(workspaceRoot, "cookguide/project.json"))).id).toBe(first.id);
  });

  it("handles concurrent creates of the same name without losing either", async () => {
    const records = await Promise.all(
      [1, 2, 3].map(() => service.createProject({ name: "Same Name" })),
    );
    expect(new Set(records.map((r) => r.slug)).size).toBe(3);
    expect((await service.scan()).projects).toHaveLength(3);
  });

  it("defaults the poster to the last frame, never durationInFrames", async () => {
    const project = await service.createProject({ name: "P" });
    const campaign = await service.createCampaign(project.id, { name: "C" });
    const production = await service.createProduction(campaign.id, {
      title: "T",
      format: PORTRAIT,
    });
    expect(production.posterFrame).toBe(359);
  });

  it("keeps composition IDs unique across campaigns", async () => {
    const project = await service.createProject({ name: "Brand" });
    const a = await service.createCampaign(project.id, { name: "A" });
    const b = await service.createCampaign(project.id, { name: "B" });
    const first = await service.createProduction(a.id, { title: "Teaser", format: PORTRAIT });
    const second = await service.createProduction(b.id, { title: "Teaser", format: PORTRAIT });
    expect(first.slug).toBe(second.slug);
    expect(first.compositionId).not.toBe(second.compositionId);
  });

  it.each([
    [{ name: "" }, "name"],
    [{ name: "!!!" }, "name"],
    [{ name: "Ok", slug: "../escape" }, "slug"],
    [{ name: "Ok", slug: "Has Spaces" }, "slug"],
    [{ name: "Ok", defaultRenderProfileId: "ultra" }, "defaultRenderProfileId"],
    [{ name: "Ok", extra: true }, ""],
  ])("rejects invalid project input %j", async (input, field) => {
    await expect(service.createProject(input)).rejects.toMatchObject({
      code: "INVALID_INPUT",
      issues: expect.arrayContaining([expect.objectContaining({ path: field })]),
    });
    expect(await listFiles(workspaceRoot)).toEqual([]);
  });

  it("enforces settings limits and poster range on productions", async () => {
    const project = await service.createProject({ name: "P" });
    const campaign = await service.createCampaign(project.id, { name: "C" });
    await expect(
      service.createProduction(campaign.id, {
        title: "Huge",
        format: { ...PORTRAIT, width: 7680 },
      }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      issues: [{ path: "format.width", message: "Maximum is 3840" }],
    });
    await expect(
      service.createProduction(campaign.id, {
        title: "Bad poster",
        format: PORTRAIT,
        posterFrame: 360,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await listFiles(path.join(workspaceRoot, "p/campaigns/c/productions"))).toEqual([
      ".gitkeep",
    ]);
  });

  it("returns NOT_FOUND for unknown or malformed parent IDs", async () => {
    await expect(
      service.createCampaign("01a13edc-0000-7000-8000-000000000000", { name: "C" }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(service.createCampaign("../../etc", { name: "C" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("updates", () => {
  it("increments the revision and updatedAt", async () => {
    const { production } = await createHierarchy();
    let tick = 0;
    service = new WorkspaceService({
      repoRoot,
      workspaceRoot,
      settings: await loadSettings(repoRoot),
      now: () => new Date(FIXED_NOW.getTime() + ++tick * 1000),
    });
    const updated = await service.updateProduction(production.id, {
      revision: 1,
      title: "Renamed",
      description: "",
      status: "briefing",
      format: PORTRAIT,
      posterFrame: 300,
      defaultRenderProfileId: "draft",
      tags: ["qr"],
    });
    expect(updated).toMatchObject({
      revision: 2,
      title: "Renamed",
      slug: production.slug,
      compositionId: production.compositionId,
    });
    expect(updated.updatedAt).not.toBe(production.updatedAt);
    expect(
      productionRecordSchema.parse(
        await readJson(
          path.join(
            workspaceRoot,
            "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert/production.json",
          ),
        ),
      ),
    ).toEqual(updated);
  });

  it("rejects a stale revision without writing", async () => {
    const { project } = await createHierarchy();
    const input = {
      revision: 1,
      name: "First",
      description: "",
      status: "active",
      defaultRenderProfileId: "standard",
      sourceRepository: null,
    };
    await service.updateProject(project.id, input);
    await expect(
      service.updateProject(project.id, { ...input, name: "Second" }),
    ).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
    expect((await readJson(path.join(workspaceRoot, "cookguide/project.json"))).name).toBe("First");
  });

  it("lets exactly one of several concurrent edits of the same revision win", async () => {
    const { campaign } = await createHierarchy();
    const edit = (name: string) =>
      service.updateCampaign(campaign.id, {
        revision: 1,
        name,
        description: "",
        objective: "",
        audience: [],
        keyMessages: [],
        channels: [],
        status: "active",
      });
    const results = await Promise.allSettled(["A", "B", "C", "D"].map(edit));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await service.scan()).projects[0]?.campaigns[0]?.record.revision).toBe(2);
  });

  it("can set and clear the informational source repository", async () => {
    const { project } = await createHierarchy();
    const base = {
      name: "CookGuide",
      description: "",
      status: "active",
      defaultRenderProfileId: "standard",
    };
    const withRepo = await service.updateProject(project.id, {
      ...base,
      revision: 1,
      sourceRepository: { path: "~/code/cookguide" },
    });
    expect(withRepo.sourceRepository).toEqual({ path: "~/code/cookguide" });
    const cleared = await service.updateProject(project.id, {
      ...base,
      revision: 2,
      sourceRepository: null,
    });
    expect(cleared).not.toHaveProperty("sourceRepository");
  });

  it("rejects a poster frame outside the new duration", async () => {
    const { production } = await createHierarchy();
    await expect(
      service.updateProduction(production.id, {
        revision: 1,
        title: "T",
        description: "",
        status: "idea",
        format: { ...PORTRAIT, durationInFrames: 300 },
        posterFrame: 300,
        defaultRenderProfileId: "standard",
        tags: [],
      }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      issues: [expect.objectContaining({ path: "posterFrame" })],
    });
  });
});

describe("documents", () => {
  it("saves when the base hash matches and rejects stale saves", async () => {
    const { production } = await createHierarchy();
    const original = await service.readDocument("production", production.id, "prompt");
    expect(original.path).toBe(
      "workspace/projects/cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert/prompt.md",
    );

    const saved = await service.saveDocument("production", production.id, "prompt", {
      content: "# Mine\n",
      baseHash: original.hash,
    });
    expect(saved.hash).toBe(hashContent("# Mine\n"));

    await expect(
      service.saveDocument("production", production.id, "prompt", {
        content: "# Stale\n",
        baseHash: original.hash,
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  });

  it("detects edits made outside the studio, for example by Claude Code", async () => {
    const { project } = await createHierarchy();
    const opened = await service.readDocument("project", project.id, "context");
    await writeFile(path.join(workspaceRoot, "cookguide/context.md"), "edited elsewhere\n");
    await expect(
      service.saveDocument("project", project.id, "context", {
        content: "mine",
        baseHash: opened.hash,
      }),
    ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    expect(await readFile(path.join(workspaceRoot, "cookguide/context.md"), "utf8")).toBe(
      "edited elsewhere\n",
    );
  });

  it("recreates an optional document that was deleted", async () => {
    const { project } = await createHierarchy();
    const { rm } = await import("node:fs/promises");
    await rm(path.join(workspaceRoot, "cookguide/brand"), { recursive: true });
    const missing = await service.readDocument("project", project.id, "brand");
    expect(missing).toMatchObject({ exists: false, content: "" });
    await service.saveDocument("project", project.id, "brand", {
      content: "# Brand\n",
      baseHash: missing.hash,
    });
    expect(await readFile(path.join(workspaceRoot, "cookguide/brand/brand.md"), "utf8")).toBe(
      "# Brand\n",
    );
  });

  it.each(["context", "../project.json", "production", "__proto__", "toString"])(
    "rejects document kind %j for productions",
    async (kind) => {
      const { production } = await createHierarchy();
      await expect(service.readDocument("production", production.id, kind)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    },
  );
});

describe("archive", () => {
  it("requires the slug as confirmation", async () => {
    const { campaign } = await createHierarchy();
    await expect(
      service.archive("campaign", campaign.id, { confirmSlug: "nope" }),
    ).rejects.toMatchObject({
      code: "CONFIRMATION_REQUIRED",
    });
    expect((await service.scan()).projects[0]?.campaigns).toHaveLength(1);
  });

  it("moves the folder and everything beneath it into the archive", async () => {
    const { campaign } = await createHierarchy();
    const before = await listFiles(path.join(workspaceRoot, "cookguide/campaigns/qr-awareness"));
    const { archivedPath } = await service.archive("campaign", campaign.id, {
      confirmSlug: "qr-awareness",
    });

    expect(archivedPath).toBe(
      `workspace/archive/20261015-120000_campaign_qr-awareness-${campaign.id.slice(-8)}`,
    );
    const archivedDir = path.join(repoRoot, archivedPath);
    expect(await listFiles(archivedDir)).toEqual([...before, "archive.json"].sort());
    expect(await readJson(path.join(archivedDir, "archive.json"))).toMatchObject({
      scope: "campaign",
      id: campaign.id,
      originalPath: "workspace/projects/cookguide/campaigns/qr-awareness",
    });

    const catalog = await service.scan();
    expect(catalog.projects[0]?.campaigns).toEqual([]);
    expect(catalog.issues).toEqual([]);
  });
});

describe("slugCandidates", () => {
  it("appends progressively longer ID suffixes within the length limit", () => {
    const id = "01a13edc-43a7-7742-9680-b0bb85388c7b";
    expect(slugCandidates("cookguide", id)).toEqual([
      "cookguide",
      "cookguide-8c7b",
      "cookguide-388c7b",
      "cookguide-85388c7b",
    ]);
    const long = slugCandidates("a".repeat(64), id);
    expect(long.every((slug) => slug.length <= 64)).toBe(true);
  });
});

describe("listFiles", () => {
  it("lists a production's files without hidden files or previews", async () => {
    const { production } = await createHierarchy();
    const dir = path.join(
      workspaceRoot,
      "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert",
    );
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path.join(dir, "renders/previews"), { recursive: true });
    await writeFile(path.join(dir, "renders/previews/temp.mp4"), "");
    await writeFile(path.join(dir, "src/composition.tsx"), "");
    const prefix =
      "workspace/projects/cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert/";
    expect(await service.listFiles("production", production.id)).toEqual(
      [
        "brief.md",
        "notes.md",
        "production.json",
        "prompt.md",
        "props.schema.json",
        "src/composition.tsx",
      ].map((f) => prefix + f),
    );
  });

  it("excludes nested campaigns from a project's file list", async () => {
    const { project } = await createHierarchy();
    expect(await service.listFiles("project", project.id)).toEqual([
      "workspace/projects/cookguide/brand/brand.md",
      "workspace/projects/cookguide/context.md",
      "workspace/projects/cookguide/project.json",
    ]);
  });
});

describe("props.json document", () => {
  it("saves a JSON object and refuses anything else", async () => {
    const { production } = await createHierarchy();
    const current = await service.readDocument("production", production.id, "props");
    expect(current).toMatchObject({ exists: false, content: "" });
    const saved = await service.saveDocument("production", production.id, "props", {
      content: '{ "headline": "Cook tonight" }\n',
      baseHash: current.hash,
    });
    expect((await service.readProductionProps(production.id)).props).toEqual({
      headline: "Cook tonight",
    });
    for (const content of ["[1]", "{ nope", '"text"']) {
      await expect(
        service.saveDocument("production", production.id, "props", {
          content,
          baseHash: saved.hash,
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });
});

describe("props schema", () => {
  it("scaffolds a schema that matches the placeholder and accepts its props", async () => {
    const { production } = await createHierarchy();
    const check = await service.checkProductionProps(production.id);
    expect(check.schema).toMatchObject({ exists: true, issues: [] });
    expect(Object.keys(check.schema.schema!.properties)).toEqual(["headline"]);
    expect(check.propsIssues).toEqual([]);
  });

  it("refuses to save props that break a valid schema, with field issues", async () => {
    const { production } = await createHierarchy();
    const dir = path.join(
      workspaceRoot,
      "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert",
    );
    await writeFile(
      path.join(dir, "props.schema.json"),
      JSON.stringify({
        type: "object",
        required: ["qrUrl"],
        properties: { qrUrl: { type: "string", format: "uri", pattern: "^https://" } },
      }),
    );
    const current = await service.readDocument("production", production.id, "props");
    await expect(
      service.saveDocument("production", production.id, "props", {
        content: '{ "qrUrl": "http://x.example" }',
        baseHash: current.hash,
      }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      issues: [{ path: "qrUrl", message: "Must start with https://" }],
    });
    await expect(
      service.saveDocument("production", production.id, "props", {
        content: "{}",
        baseHash: current.hash,
      }),
    ).rejects.toMatchObject({ issues: [{ path: "qrUrl", message: "Required" }] });
    await service.saveDocument("production", production.id, "props", {
      content: '{ "qrUrl": "https://x.example" }',
      baseHash: current.hash,
    });
  });

  it("still saves props when the schema itself is broken, and reports the schema", async () => {
    const { production } = await createHierarchy();
    const dir = path.join(
      workspaceRoot,
      "cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert",
    );
    await writeFile(
      path.join(dir, "props.schema.json"),
      '{ "type": "object", "properties": { "x": { "type": "array" } } }',
    );
    const current = await service.readDocument("production", production.id, "props");
    await service.saveDocument("production", production.id, "props", {
      content: '{ "x": 1 }',
      baseHash: current.hash,
    });
    const check = await service.checkProductionProps(production.id);
    expect(check.schema.schema).toBeUndefined();
    expect(check.schema.issues.length).toBeGreaterThan(0);
  });
});
