import {
  AssetLibrary,
  findRepoRoot,
  loadSettings,
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
    return new WorkspaceService({ repoRoot, workspaceRoot, settings });
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
