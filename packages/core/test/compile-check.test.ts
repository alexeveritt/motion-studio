import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkProductionSource, formatDiagnostic } from "../src/compile-check.ts";
import { loadSettings } from "../src/repo.ts";
import type { ProductionRecord } from "../src/schemas/production.ts";
import { WorkspaceService } from "../src/workspace.ts";
import { REPO_ROOT } from "./helpers.ts";

// Inside the repository so `remotion` and the runtime resolve from node_modules.
const scratch = path.join(
  REPO_ROOT,
  ".motion-studio/tmp",
  `vitest-compile-${randomBytes(4).toString("hex")}`,
);
let workspace: WorkspaceService;
let production: ProductionRecord;
let entry: string;

beforeAll(async () => {
  await mkdir(path.join(scratch, "projects"), { recursive: true });
  workspace = new WorkspaceService({
    repoRoot: REPO_ROOT,
    workspaceRoot: path.join(scratch, "projects"),
    settings: await loadSettings(REPO_ROOT),
  });
  const project = await workspace.createProject({ name: "Compile" });
  const campaign = await workspace.createCampaign(project.id, { name: "C" });
  production = await workspace.createProduction(campaign.id, {
    title: "Check",
    format: { width: 1080, height: 1920, fps: 30, durationInFrames: 90 },
  });
  entry = path.join(scratch, "projects/compile/campaigns/c/productions/check/src/composition.tsx");
}, 30_000);

afterAll(() => rm(scratch, { recursive: true, force: true }));

describe("checkProductionSource", () => {
  it("passes the scaffolded placeholder", async () => {
    const result = await checkProductionSource(workspace, production.id);
    expect(result.diagnostics.map(formatDiagnostic)).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.files).toEqual([path.relative(REPO_ROOT, entry)]);
  }, 30_000);

  it("reports syntax errors with file, line and column", async () => {
    await writeFile(entry, 'export const composition = {\n  id: "compile-check",\n  oops\n');
    const result = await checkProductionSource(workspace, production.id);
    expect(result.ok).toBe(false);
    expect(result.diagnostics[0]).toMatchObject({
      file: path.relative(REPO_ROOT, entry),
      line: expect.any(Number),
    });
  }, 30_000);

  it("reports type errors against the composition contract", async () => {
    await writeFile(
      entry,
      `import type { MotionStudioComposition } from "@motion-studio/motion-runtime";
const Broken = ({ title }: { title: string }) => <div>{title.toFixed(2)}</div>;
export const composition: MotionStudioComposition<{ title: string }> = { id: "compile-check", Component: Broken, defaultProps: { title: 3 } };
`,
    );
    const result = await checkProductionSource(workspace, production.id);
    const messages = result.diagnostics.map((d) => d.message).join("\n");
    expect(messages).toContain("toFixed");
    expect(messages).toMatch(/number.*not assignable to.*string/);
  }, 30_000);

  it("reports a missing entry file", async () => {
    await rm(entry);
    const result = await checkProductionSource(workspace, production.id);
    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ message: "src/composition.tsx does not exist" }],
    });
  }, 30_000);
});
