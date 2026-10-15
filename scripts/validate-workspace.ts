/**
 * Validate every project, campaign and production record and their
 * cross-references. Exits non-zero when any error is found.
 *
 *   pnpm validate:workspace
 *   pnpm validate:workspace -- --workspace fixtures/workspace/projects
 */
import { parseArgs } from "node:util";
import {
  findRepoRoot,
  loadSettings,
  MotionStudioError,
  resolveWorkspaceRoot,
  scanCatalog,
} from "@motion-studio/core";

// pnpm forwards the `--` separator from `pnpm validate:workspace -- --flag`.
const argv = process.argv.slice(2);
const { values } = parseArgs({
  args: argv[0] === "--" ? argv.slice(1) : argv,
  options: { workspace: { type: "string" } },
  allowPositionals: false,
});

try {
  const repoRoot = findRepoRoot(process.cwd());
  const settings = await loadSettings(repoRoot);
  const workspaceRoot = resolveWorkspaceRoot(
    repoRoot,
    settings,
    values.workspace ?? (process.env.MOTION_STUDIO_WORKSPACE || undefined),
  );
  const catalog = await scanCatalog({ repoRoot, workspaceRoot, settings });

  const campaigns = catalog.projects.flatMap((p) => p.campaigns);
  const productions = campaigns.flatMap((c) => c.productions);
  console.log(
    `Workspace ${catalog.workspacePath}: ${catalog.projects.length} projects, ${campaigns.length} campaigns, ${productions.length} productions`,
  );

  for (const issue of catalog.issues) {
    console.log(`${issue.severity.toUpperCase()} ${issue.code} ${issue.path}\n  ${issue.message}`);
  }

  const errors = catalog.issues.filter((issue) => issue.severity === "error").length;
  const warnings = catalog.issues.length - errors;
  console.log(
    errors === 0 ? `OK (${warnings} warnings)` : `FAILED (${errors} errors, ${warnings} warnings)`,
  );
  process.exitCode = errors === 0 ? 0 : 1;
} catch (error) {
  console.error(error instanceof MotionStudioError ? `${error.code}: ${error.message}` : error);
  process.exitCode = 1;
}
