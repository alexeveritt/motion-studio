import { parseArgs, type ParseArgsConfig } from "node:util";
import {
  AssetLibrary,
  findRepoRoot,
  loadSettings,
  MotionStudioError,
  resolveJobsRoot,
  resolveWorkspaceRoot,
  WorkspaceService,
} from "@motion-studio/core";

/** parseArgs that tolerates the `--` pnpm forwards from `pnpm <script> -- <args>`. */
export function parseCliArgs<T extends ParseArgsConfig["options"]>(
  options: T,
  allowPositionals = false,
) {
  const argv = process.argv.slice(2);
  return parseArgs({ args: argv[0] === "--" ? argv.slice(1) : argv, options, allowPositionals });
}

/** Open the workspace the same way the studio does. */
export async function openWorkspace(workspaceOverride?: string) {
  const repoRoot = findRepoRoot(process.cwd());
  const settings = await loadSettings(repoRoot);
  const workspaceRoot = resolveWorkspaceRoot(
    repoRoot,
    settings,
    workspaceOverride ?? (process.env.MOTION_STUDIO_WORKSPACE || undefined),
  );
  const jobsRoot = resolveJobsRoot(repoRoot, process.env.MOTION_STUDIO_JOBS || undefined);
  const workspace = new WorkspaceService({
    repoRoot,
    workspaceRoot,
    settings,
    ...(jobsRoot ? { jobsRoot } : {}),
  });
  return { workspace, assets: new AssetLibrary(workspace) };
}

/** Run a CLI entry point, printing Motion Studio errors without stack traces. */
export async function runCli(main: () => Promise<number | void>): Promise<void> {
  try {
    process.exitCode = (await main()) ?? 0;
  } catch (error) {
    console.error(error instanceof MotionStudioError ? `${error.code}: ${error.message}` : error);
    process.exitCode = 1;
  }
}
