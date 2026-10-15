import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { hashFile, type AssetLibrary } from "../assets.ts";
import { MotionStudioError } from "../errors.ts";
import type { ProductionRecord } from "../schemas/production.ts";
import type { RenderProfile } from "../schemas/render-profile.ts";
import type { WorkspaceService } from "../workspace.ts";
import { canonicalJson, sha256 } from "./canonical.ts";

/**
 * Everything that determines a render's pixels. Timestamps, titles, status and
 * revision are deliberately excluded so editing a description does not change
 * the fingerprint, while changing a frame count, a source file, an asset, the
 * props, the profile, the shared runtime or the lockfile does.
 */
export type FingerprintInputs = {
  production: Pick<ProductionRecord, "id" | "compositionId" | "format" | "posterFrame">;
  profile: RenderProfile;
  props: Record<string, unknown>;
  /** Production source files, path relative to the production folder -> SHA-256. */
  source: Record<string, string>;
  /** Shared runtime source, path relative to packages/motion-runtime -> SHA-256. */
  runtime: Record<string, string>;
  /** "<scope>:<stored name>" -> SHA-256 from the asset sidecar. */
  assets: Record<string, string>;
  lockfile: string;
};

export function computeFingerprint(inputs: FingerprintInputs): string {
  return sha256(canonicalJson({ version: 1, ...inputs }));
}

/** Collect fingerprint inputs from disk for a production and profile. */
export async function gatherFingerprintInputs(
  workspace: WorkspaceService,
  assets: AssetLibrary,
  productionId: string,
  profile: RenderProfile,
): Promise<FingerprintInputs> {
  const { dir, record } = await workspace.locate("production", productionId);
  const production = record as ProductionRecord;
  const props = await workspace.readProductionProps(productionId);
  if (props.error) throw new MotionStudioError("INVALID_INPUT", props.error);

  const assetHashes: Record<string, string> = {};
  for (const listing of await assetChain(workspace, assets, productionId)) {
    for (const asset of listing.assets)
      assetHashes[`${listing.scope}:${asset.record.storedName}`] = asset.record.sha256;
  }

  const lockfile = await readFile(path.join(workspace.repoRoot, "pnpm-lock.yaml"), "utf8").catch(
    () => "",
  );
  return {
    production: {
      id: production.id,
      compositionId: production.compositionId,
      format: production.format,
      posterFrame: production.posterFrame,
    },
    profile,
    props: props.props,
    source: await hashTree(workspace.policy.resolve(dir, "src")),
    runtime: await hashTree(path.join(workspace.repoRoot, "packages", "motion-runtime", "src")),
    assets: assetHashes,
    lockfile: sha256(lockfile),
  };
}

/** Asset listings a production can reach: its own, its campaign's, its project's and its brand's. */
export async function assetChain(
  workspace: WorkspaceService,
  assets: AssetLibrary,
  productionId: string,
) {
  const catalog = await workspace.scan();
  for (const project of catalog.projects) {
    for (const campaign of project.campaigns) {
      if (!campaign.productions.some((production) => production.record.id === productionId))
        continue;
      return Promise.all([
        assets.list("production", productionId),
        assets.list("campaign", campaign.record.id),
        assets.list("project", project.record.id),
        assets.list("brand", project.record.id),
      ]);
    }
  }
  throw new MotionStudioError("NOT_FOUND", "The production was not found");
}

/** SHA-256 of every regular file under `dir`, keyed by POSIX path relative to it. Hidden files and symlinks are skipped. */
export async function hashTree(dir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  const walk = async (current: string, depth: number) => {
    if (depth > 10) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.isSymbolicLink() || entry.name === "node_modules")
        continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (entry.isFile())
        result[path.relative(dir, full).split(path.sep).join("/")] = await hashFile(full);
    }
  };
  await walk(dir, 0);
  return result;
}
