/**
 * Validate every project, campaign and production record, their
 * cross-references, every asset sidecar and file hash, props against their
 * schema, and approved renders against their files. Exits non-zero
 * when any error is found.
 *
 *   pnpm validate:workspace
 *   pnpm validate:workspace -- --workspace fixtures/workspace/projects
 */
import { propsStatus, RenderApprovals, RenderController } from "@motion-studio/core";
import { openWorkspace, parseCliArgs, runCli } from "./lib/cli.ts";

await runCli(async () => {
  const { values } = parseCliArgs({ workspace: { type: "string" } });
  const { workspace, assets } = await openWorkspace(values.workspace);
  const catalog = await workspace.scan();
  const issues = [...catalog.issues, ...(await assets.validate(catalog))];
  const approvals = new RenderApprovals(workspace, assets, new RenderController(workspace, assets));

  // props.json against props.schema.json, the same rule preflight applies.
  for (const production of catalog.projects.flatMap((p) =>
    p.campaigns.flatMap((c) => c.productions),
  )) {
    const [status, messages] = propsStatus(
      await workspace.checkProductionProps(production.record.id),
    );
    if (status === "pass") continue;
    for (const message of messages) {
      issues.push({
        severity: status === "fail" ? "error" : "warning",
        code: "SCHEMA_INVALID",
        path: `${production.path}/props.json`,
        message,
      });
    }

    // renders/approved.json: a broken approval is an error, an outdated one a warning.
    const approval = await approvals.status(production.record.id);
    if (approval.state === "broken" || approval.state === "outdated") {
      for (const message of approval.problems) {
        issues.push({
          severity: approval.state === "broken" ? "error" : "warning",
          code: "REFERENCE_MISMATCH",
          path: approval.path,
          message,
        });
      }
    }
  }

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
