/**
 * Validate every project, campaign and production record, their
 * cross-references, and every asset sidecar and file hash. Exits non-zero
 * when any error is found.
 *
 *   pnpm validate:workspace
 *   pnpm validate:workspace -- --workspace fixtures/workspace/projects
 */
import { openWorkspace, parseCliArgs, runCli } from "./lib/cli.ts";

await runCli(async () => {
  const { values } = parseCliArgs({ workspace: { type: "string" } });
  const { workspace, assets } = await openWorkspace(values.workspace);
  const catalog = await workspace.scan();
  const issues = [...catalog.issues, ...(await assets.validate(catalog))];

  const campaigns = catalog.projects.flatMap((p) => p.campaigns);
  const productions = campaigns.flatMap((c) => c.productions);
  console.log(
    `Workspace ${catalog.workspacePath}: ${catalog.projects.length} projects, ${campaigns.length} campaigns, ${productions.length} productions`,
  );
  for (const issue of issues) {
    console.log(`${issue.severity.toUpperCase()} ${issue.code} ${issue.path}\n  ${issue.message}`);
  }
  const errors = issues.filter((issue) => issue.severity === "error").length;
  const warnings = issues.length - errors;
  console.log(
    errors === 0 ? `OK (${warnings} warnings)` : `FAILED (${errors} errors, ${warnings} warnings)`,
  );
  return errors === 0 ? 0 : 1;
});
