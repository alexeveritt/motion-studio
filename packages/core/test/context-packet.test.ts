import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AssetLibrary } from "../src/assets.ts";
import { buildContextPacket, createPromptCandidate } from "../src/context-packet.ts";
import { loadSettings } from "../src/repo.ts";
import type { ProductionRecord } from "../src/schemas/production.ts";
import { WorkspaceService } from "../src/workspace.ts";
import { makeEmptyRepo } from "./helpers.ts";
import { makePng } from "./media-fixtures.ts";

let repoRoot: string;
let workspace: WorkspaceService;
let assets: AssetLibrary;
let production: ProductionRecord;
const productionPath =
  "workspace/projects/cookguide/campaigns/qr-awareness/productions/qr-code-advert";

beforeEach(async () => {
  let workspaceRoot: string;
  ({ repoRoot, workspaceRoot } = await makeEmptyRepo());
  workspace = new WorkspaceService({
    repoRoot,
    workspaceRoot,
    settings: await loadSettings(repoRoot),
    now: () => new Date("2026-10-15T12:00:00.000Z"),
  });
  assets = new AssetLibrary(workspace);
  const project = await workspace.createProject({
    name: "CookGuide",
    sourceRepository: { path: "~/code/cookguide" },
  });
  const campaign = await workspace.createCampaign(project.id, {
    name: "QR Awareness",
    objective: "Drive scans",
    audience: ["Home cooks"],
  });
  production = await workspace.createProduction(campaign.id, {
    title: "QR Code Advert",
    format: { width: 1080, height: 1920, fps: 30, durationInFrames: 360 },
    posterFrame: 300,
  });
  await workspace.saveDocument("project", project.id, "context", {
    content:
      "# CookGuide\n\n## Claims that must not be made\nNo health claims.\n```ts\nconst fenced = true;\n```\n",
    baseHash: (await workspace.readDocument("project", project.id, "context")).hash,
  });
  await assets.upload("production", production.id, {
    originalName: "Logo.png",
    body: (async function* () {
      yield makePng(400, 100);
    })(),
  });
  await writeFile(path.join(repoRoot, productionPath, "src/composition.tsx"), "export {};\n");
});

describe("buildContextPacket", () => {
  it("contains every section required by the spec", async () => {
    const packet = await buildContextPacket(workspace, assets, production.id, {
      studioUrl: "http://127.0.0.1:4321",
    });
    const headings = topLevelHeadings(packet);
    expect(headings).toEqual([
      "# Context packet: QR Code Advert",
      "## Request",
      "## Edit boundary",
      "## Repository",
      "## Composition contract",
      "## Production",
      "## Render profile: Standard",
      "## Project: CookGuide",
      "## Campaign: QR Awareness",
      "## Project context",
      "## Brand guidance",
      "## Production brief",
      "## Assets",
      "## Existing source files",
      "## Commands",
    ]);
    expect(packet).toContain("Do not commit, push, or change branches.");
    expect(packet).toContain(`Work only inside \`${productionPath}/\``);
    expect(packet).toContain("| Duration | 360 frames (12s); last frame is 359 |");
    expect(packet).toContain('id: "cookguide-qr-code-advert"');
    expect(packet).toContain("No health claims.");
    expect(packet).toContain("~/code/cookguide");
    expect(packet).toMatch(
      new RegExp(`\\| \`${productionPath}/assets/logo.png\` \\| image/png \\| 400×100 \\|`),
    );
    expect(packet).toContain(`- \`${productionPath}/src/composition.tsx\``);
    expect(packet).toContain(
      `http://127.0.0.1:4321/projects/cookguide/campaigns/qr-awareness/productions/qr-code-advert`,
    );
    expect(packet).toContain(`pnpm -s context-packet -- ${production.id}`);
  });

  it("fences embedded documents so their code fences cannot break out", async () => {
    const packet = await buildContextPacket(workspace, assets, production.id);
    expect(packet).toContain("````markdown\n# CookGuide");
  });

  it("does not leak absolute paths", async () => {
    const packet = await buildContextPacket(workspace, assets, production.id);
    expect(packet).not.toContain(repoRoot);
  });

  it("is stable for unchanged inputs", async () => {
    expect(await buildContextPacket(workspace, assets, production.id)).toBe(
      await buildContextPacket(workspace, assets, production.id),
    );
  });
});

describe("createPromptCandidate", () => {
  it("saves a candidate in tmp without touching prompt.md and returns a diff", async () => {
    const promptFile = path.join(repoRoot, productionPath, "prompt.md");
    const current = await workspace.readDocument("production", production.id, "prompt");
    await workspace.saveDocument("production", production.id, "prompt", {
      content: "# My own prompt\n\nKeep the QR static.\n",
      baseHash: current.hash,
    });

    const first = await createPromptCandidate(workspace, production.id);
    const second = await createPromptCandidate(workspace, production.id);

    expect(await readFile(promptFile, "utf8")).toBe("# My own prompt\n\nKeep the QR static.\n");
    expect(first.candidatePath).toMatch(
      /^\.motion-studio\/tmp\/prompt-candidates\/qr-code-advert-[0-9a-f]{8}\/20261015-120000\.md$/,
    );
    expect(second.candidatePath).toMatch(/20261015-120000-2\.md$/);
    expect(await readFile(path.join(repoRoot, first.candidatePath), "utf8")).toBe(first.candidate);
    expect(first.diff).toContainEqual({ op: "remove", text: "Keep the QR static." });
    expect(first.diff).toContainEqual({ op: "add", text: "# Implement QR Code Advert" });
  });
});

/** Level 1 and 2 headings outside fenced blocks. */
function topLevelHeadings(markdown: string): string[] {
  const headings: string[] = [];
  let fence: string | undefined;
  for (const line of markdown.split("\n")) {
    const marker = /^(`{3,})/.exec(line)?.[1];
    if (marker && (!fence || marker === fence)) {
      fence = fence ? undefined : marker;
      continue;
    }
    if (!fence && /^##? /.test(line)) headings.push(line);
  }
  return headings;
}
