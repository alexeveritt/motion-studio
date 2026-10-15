import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AssetLibrary } from "../assets.ts";
import { checkProductionSource, formatDiagnostic } from "../compile-check.ts";
import { MotionStudioError } from "../errors.ts";
import type { ProductionRecord } from "../schemas/production.ts";
import type { RenderProfile } from "../schemas/render-profile.ts";
import { formatLimitIssues, type WorkspaceService } from "../workspace.ts";
import { pinnedVersions, remotionVersions } from "./environment.ts";
import { assetChain, computeFingerprint, gatherFingerprintInputs } from "./fingerprint.ts";
import { gitState, type GitState } from "./git.ts";
import { outputSize } from "./options.ts";
import { canProbe } from "./probe.ts";

export type CheckStatus = "pass" | "warn" | "fail";

export type PreflightCheck = { id: string; label: string; status: CheckStatus; messages: string[] };

export type PreflightResult = {
  ok: boolean;
  productionId: string;
  profileId: string;
  checks: PreflightCheck[];
  fingerprint?: string;
  output?: { width: number; height: number; fps: number; durationInFrames: number };
  git?: GitState;
};

/**
 * Pre-render checks from spec section 11.1. Failures block rendering;
 * warnings are shown but do not. Runtime errors inside the composition are
 * caught by the render job's sample-frame check, which runs before the full
 * render.
 */
export async function runPreflight(
  workspace: WorkspaceService,
  assets: AssetLibrary,
  productionId: string,
  profileId: string,
): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  const add = (id: string, label: string, status: CheckStatus, messages: string[] = []) =>
    checks.push({ id, label, status, messages });

  const catalog = await workspace.scan();
  const located = catalog.projects
    .flatMap((project) => project.campaigns.map((campaign) => ({ project, campaign })))
    .flatMap(({ project, campaign }) =>
      campaign.productions.map((production) => ({ project, campaign, production })),
    )
    .find(({ production }) => production.record.id === productionId);
  if (!located) throw new MotionStudioError("NOT_FOUND", "The production was not found");
  const production: ProductionRecord = located.production.record;
  const { project, campaign } = located;

  // 1. Records
  const relevant = catalog.issues.filter(
    (issue) =>
      issue.path === project.path ||
      issue.path === campaign.path ||
      issue.path.startsWith(`${located.production.path}/`) ||
      issue.path === located.production.path,
  );
  add(
    "records",
    "Project, campaign and production records",
    relevant.some((issue) => issue.severity === "error")
      ? "fail"
      : relevant.length
        ? "warn"
        : "pass",
    relevant.map((issue) => `${issue.path}: ${issue.message}`),
  );

  // 6. Profile (needed by later checks)
  const profile: RenderProfile | undefined = workspace.settings.renderProfiles.find(
    (p) => p.id === profileId,
  );
  add(
    "profile",
    "Render profile",
    profile ? "pass" : "fail",
    profile
      ? [`${profile.name}: CRF ${profile.crf}, scale ${profile.scale ?? 1}`]
      : [`Unknown profile "${profileId}"`],
  );

  // 2. Source compiles
  const source = await checkProductionSource(workspace, productionId);
  add(
    "source",
    "Composition source type-checks",
    source.ok ? "pass" : "fail",
    source.ok
      ? [`${source.files.length} file(s)`]
      : source.diagnostics.slice(0, 8).map(formatDiagnostic),
  );

  // 3. Limits and output size
  const limitIssues = formatLimitIssues(production.format, workspace.settings).map(
    (issue) => `${issue.path}: ${issue.message}`,
  );
  const size = profile ? outputSize(production.format, profile) : undefined;
  if (size && (size.width % 2 !== 0 || size.height % 2 !== 0)) {
    limitIssues.push(
      `Output ${size.width}×${size.height} must have even dimensions for yuv420p; choose another scale`,
    );
  }
  add(
    "limits",
    "Format within configured limits",
    limitIssues.length ? "fail" : "pass",
    limitIssues,
  );

  // 4. Assets and props
  const assetMessages: string[] = [];
  const assetWarnings: string[] = [];
  for (const listing of await assetChain(workspace, assets, productionId)) {
    for (const problem of listing.problems)
      assetMessages.push(`${problem.path}: ${problem.message}`);
    for (const asset of listing.assets) {
      if (asset.status === "missing") assetMessages.push(`${asset.path} is missing`);
      if (asset.status === "modified")
        assetMessages.push(`${asset.path} no longer matches its recorded SHA-256`);
      if (
        asset.status === "ok" &&
        (asset.record.mediaType === "audio" || asset.record.mediaType === "video")
      ) {
        if (!(await canProbe(path.join(workspace.repoRoot, ...asset.path.split("/"))))) {
          assetMessages.push(`${asset.path} could not be read by ffprobe`);
        }
      }
    }
    for (const file of listing.unregistered)
      assetWarnings.push(`${file.path} has no sidecar and cannot be used`);
  }
  const props = await workspace.readProductionProps(productionId);
  if (props.error) assetMessages.push(`${props.path}: ${props.error}`);
  add(
    "assets",
    "Assets present, unchanged and readable",
    assetMessages.length ? "fail" : assetWarnings.length ? "warn" : "pass",
    [...assetMessages, ...assetWarnings],
  );

  // 5. Poster frame
  const lastFrame = production.format.durationInFrames - 1;
  add(
    "poster",
    "Poster frame in range",
    production.posterFrame >= 0 && production.posterFrame <= lastFrame ? "pass" : "fail",
    [`Frame ${production.posterFrame} of 0–${lastFrame}`],
  );

  // 7. Tools and pinned versions
  const versions = await remotionVersions(workspace.repoRoot);
  const pinned = await pinnedVersions(workspace.repoRoot);
  const toolMessages: string[] = [];
  for (const [name, version] of Object.entries(versions)) {
    if (!version) toolMessages.push(`${name} is not installed; run pnpm install`);
    else if (pinned.remotion && version !== pinned.remotion)
      toolMessages.push(`${name} is ${version}, pinned ${pinned.remotion}`);
  }
  const nodeWarning =
    pinned.node && process.version !== `v${pinned.node}`
      ? [`Node ${process.version}; the pinned version is ${pinned.node}`]
      : [];
  add(
    "tools",
    "Rendering tools match pinned versions",
    toolMessages.length ? "fail" : nodeWarning.length ? "warn" : "pass",
    [
      ...toolMessages,
      ...nodeWarning,
      ...(toolMessages.length ? [] : [`Remotion ${versions.remotion}`]),
    ],
  );

  // 8. Writable output and job folders
  const productionDir = path.join(workspace.repoRoot, ...located.production.path.split("/"));
  const writable: string[] = [];
  for (const dir of [
    workspace.policy.resolve(productionDir, "renders", "final"),
    workspace.policy.resolve(productionDir, "renders", "manifests"),
    path.join(workspace.repoRoot, ".motion-studio", "jobs"),
  ]) {
    try {
      await mkdir(dir, { recursive: true });
      const probeFile = path.join(dir, `.write-check-${process.pid}`);
      await writeFile(probeFile, "");
      await rm(probeFile);
    } catch {
      writable.push(`${path.relative(workspace.repoRoot, dir)} is not writable`);
    }
  }
  add("writable", "Output folders writable", writable.length ? "fail" : "pass", writable);

  // 9. Git state
  const git = await gitState(workspace.repoRoot);
  add(
    "git",
    "Git state recorded",
    !git ? "warn" : git.dirty ? "warn" : "pass",
    !git
      ? ["Git is not available; the manifest will not record a commit"]
      : [
          `${git.commit ? git.commit.slice(0, 12) : "no commits yet"}${git.dirty ? ", with uncommitted changes (recorded in the manifest)" : ", clean"}`,
        ],
  );

  // 10. Fingerprint
  let fingerprint: string | undefined;
  if (profile && !props.error) {
    fingerprint = computeFingerprint(
      await gatherFingerprintInputs(workspace, assets, productionId, profile),
    );
    add("fingerprint", "Input fingerprint", "pass", [fingerprint]);
  } else {
    add("fingerprint", "Input fingerprint", "fail", [
      "Not calculated until the profile and props are valid",
    ]);
  }

  return {
    ok: checks.every((check) => check.status !== "fail"),
    productionId,
    profileId,
    checks,
    ...(fingerprint ? { fingerprint } : {}),
    ...(size
      ? {
          output: {
            ...size,
            fps: production.format.fps,
            durationInFrames: production.format.durationInFrames,
          },
        }
      : {}),
    ...(git ? { git } : {}),
  };
}
