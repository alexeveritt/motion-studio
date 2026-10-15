import { cp, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const FIXTURE_WORKSPACE = path.join(REPO_ROOT, "fixtures/workspace/projects");
export const FIXTURE_PROJECT = path.join(FIXTURE_WORKSPACE, "sample-studio");
export const FIXTURE_CAMPAIGN = path.join(FIXTURE_PROJECT, "campaigns/launch-teaser");
export const FIXTURE_PRODUCTION = path.join(FIXTURE_CAMPAIGN, "productions/square-teaser");

export async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

/** Copy the fixture workspace into a throwaway temp repo so tests can break it freely. */
export async function makeTempRepo(): Promise<{ repoRoot: string; workspaceRoot: string }> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "motion-studio-test-"));
  await cp(
    path.join(REPO_ROOT, ".motion-studio/settings.json"),
    path.join(repoRoot, ".motion-studio/settings.json"),
  );
  const workspaceRoot = path.join(repoRoot, "workspace/projects");
  await cp(FIXTURE_WORKSPACE, workspaceRoot, { recursive: true });
  return { repoRoot, workspaceRoot };
}

/** A temp repo with real settings and an empty workspace. */
export async function makeEmptyRepo(): Promise<{ repoRoot: string; workspaceRoot: string }> {
  const repoRoot = await realpath(await mkdtemp(path.join(tmpdir(), "motion-studio-test-")));
  await cp(
    path.join(REPO_ROOT, ".motion-studio/settings.json"),
    path.join(repoRoot, ".motion-studio/settings.json"),
  );
  const workspaceRoot = path.join(repoRoot, "workspace/projects");
  await mkdir(workspaceRoot, { recursive: true });
  return { repoRoot, workspaceRoot };
}

/** Recursively list files beneath `dir` as sorted POSIX paths. */
export async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"),
    )
    .sort();
}

export async function patchJson(file: string, patch: Record<string, unknown>): Promise<void> {
  await writeFile(file, JSON.stringify({ ...(await readJson(file)), ...patch }, null, 2));
}
