import {
  AssetLibrary,
  findRepoRoot,
  RenderController,
  loadSettings,
  resolveJobsRoot,
  resolveWorkspaceRoot,
  WorkspaceService,
  writeRegistry,
  type Catalog,
  type RegistryResult,
} from "@motion-studio/core";

import { invalidateRegistryModule } from "./registry-integration.ts";

let workspace: Promise<WorkspaceService> | undefined;

/**
 * Server-only workspace service, resolved once per process. Restart the
 * studio after editing `.motion-studio/settings.json`.
 */
export function getWorkspace(): Promise<WorkspaceService> {
  workspace ??= (async () => {
    const repoRoot = findRepoRoot(process.cwd());
    const settings = await loadSettings(repoRoot);
    const workspaceRoot = resolveWorkspaceRoot(
      repoRoot,
      settings,
      process.env.MOTION_STUDIO_WORKSPACE || undefined,
    );
    const jobsRoot = resolveJobsRoot(repoRoot, process.env.MOTION_STUDIO_JOBS || undefined);
    return new WorkspaceService({
      repoRoot,
      workspaceRoot,
      settings,
      ...(jobsRoot ? { jobsRoot } : {}),
    });
  })();
  workspace.catch(() => {
    workspace = undefined;
  });
  return workspace;
}

/** The catalog is rebuilt from disk on every call; files are the source of truth. */
export async function getCatalog(): Promise<Catalog> {
  return (await getWorkspace()).scan();
}

let assets: AssetLibrary | undefined;

export async function getAssets(): Promise<AssetLibrary> {
  const workspace = await getWorkspace();
  assets ??= new AssetLibrary(workspace);
  return assets;
}

/**
 * Regenerate the composition registry. Called on preview loads and after a
 * production or placeholder is created, so new entry files appear without a
 * restart.
 */
export async function refreshRegistry(): Promise<RegistryResult> {
  const result = await writeRegistry(await getWorkspace());
  if (result.changed) invalidateRegistryModule(result.file);
  return result;
}

let renders: Promise<RenderController> | undefined;

/**
 * The studio's render controller. Created once; on creation it recovers jobs
 * left running by a previous process (spec section 11.4).
 */
export function getRenders(): Promise<RenderController> {
  renders ??= (async () => {
    const controller = new RenderController(await getWorkspace(), await getAssets());
    const recovered = await controller.recover();
    if (recovered.length > 0)
      console.warn(`Marked ${recovered.length} interrupted render(s) from an earlier run.`);
    return controller;
  })();
  renders.catch(() => {
    renders = undefined;
  });
  return renders;
}
