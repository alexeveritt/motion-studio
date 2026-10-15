import { mkdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { hashFile, type AssetLibrary } from "../assets.ts";
import { MotionStudioError } from "../errors.ts";
import { KeyedMutex, serializeJson, writeFileAtomic } from "../fs-store.ts";
import { toRepoRelative } from "../repo.ts";
import { parseInput } from "../schemas/parse.ts";
import {
  renderApprovalInputSchema,
  renderApprovalRemoveSchema,
  renderApprovalSchema,
  renderArchiveInputSchema,
  type RenderApproval,
} from "../schemas/render-approval.ts";
import { renderManifestSchema, type RenderManifest } from "../schemas/render-manifest.ts";
import { CURRENT_SCHEMA_VERSION } from "../schemas/common.ts";
import type { ProductionRecord } from "../schemas/production.ts";
import { formatStamp, hashContent, type WorkspaceService } from "../workspace.ts";
import type { RenderController } from "./controller.ts";
import { computeFingerprint, gatherFingerprintInputs } from "./fingerprint.ts";

export const APPROVAL_FILE = "approved.json";

/**
 * - `none`: no render is approved.
 * - `current`: the approved files are intact and the production's inputs
 *   still match the approved render.
 * - `outdated`: the files are intact, but source, props, assets or settings
 *   have changed since that render, so a new render would differ.
 * - `broken`: approved.json is invalid, or a file it names is missing or changed.
 */
export type ApprovalState = "none" | "current" | "outdated" | "broken";

export type ApprovalStatus = {
  state: ApprovalState;
  /** Repository-relative path of approved.json. */
  path: string;
  /** Hash of approved.json as read; pass back as `baseHash` to change it. */
  hash: string;
  approval?: RenderApproval;
  problems: string[];
  /** Fingerprint of the current inputs for the approved profile, when it could be computed. */
  currentFingerprint?: string;
};

export type RenderArchiveResult = {
  /** Repository-relative archive folder. */
  archivedPath: string;
  renderIds: string[];
  /** Production-relative paths of the files moved. */
  files: string[];
};

/**
 * Approval of one successful video render per production, recorded in
 * `renders/approved.json` next to the manifests, and archiving of the renders
 * that are not wanted. Approval changes are guarded by the file's content
 * hash, like documents, so a stale tab cannot overwrite an approval made
 * elsewhere. Render manifests themselves are never modified, and nothing is
 * ever deleted.
 */
export class RenderApprovals {
  readonly #workspace: WorkspaceService;
  readonly #assets: AssetLibrary;
  readonly #renders: RenderController;
  readonly #mutex = new KeyedMutex();

  constructor(workspace: WorkspaceService, assets: AssetLibrary, renders: RenderController) {
    this.#workspace = workspace;
    this.#assets = assets;
    this.#renders = renders;
  }

  async status(productionId: string): Promise<ApprovalStatus> {
    const { dir } = await this.#workspace.locate("production", productionId);
    const file = this.#file(dir);
    const raw = await readOptional(file);
    const base = { path: toRepoRelative(this.#workspace.repoRoot, file), hash: hashContent(raw) };
    if (raw === "") return { ...base, state: "none", problems: [] };

    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ...base, state: "broken", problems: [`${base.path} is not valid JSON`] };
    }
    const parsed = renderApprovalSchema.safeParse(data);
    if (!parsed.success) {
      return {
        ...base,
        state: "broken",
        problems: parsed.error.issues.map(
          (issue) => `${base.path} ${issue.path.join(".") || "(root)"}: ${issue.message}`,
        ),
      };
    }
    const approval = parsed.data;
    const problems = await this.#verify(dir, productionId, approval);
    if (problems.length > 0) return { ...base, state: "broken", approval, problems };

    const currentFingerprint = await this.#currentFingerprint(productionId, approval.profileId);
    const outdated =
      currentFingerprint !== undefined && currentFingerprint !== approval.inputFingerprint;
    return {
      ...base,
      state: outdated ? "outdated" : "current",
      approval,
      problems: outdated
        ? [
            "Source, props, assets, settings or dependencies have changed since this render. Render again and approve the new render if the changes should ship.",
          ]
        : [],
      ...(currentFingerprint ? { currentFingerprint } : {}),
    };
  }

  /** Approve a successful video render, replacing any earlier approval. */
  async approve(productionId: string, rawInput: unknown): Promise<ApprovalStatus> {
    const input = parseInput(renderApprovalInputSchema, rawInput, "approval");
    const { dir } = await this.#workspace.locate("production", productionId);
    const file = this.#file(dir);
    return this.#mutex.run(file, async () => {
      await this.#assertUnchanged(file, input.baseHash);
      const { outputs } = await this.#renders.history(productionId);
      const entry = outputs.find(
        (output) => output.kind === "render" && output.manifest.renderId === input.renderId,
      );
      if (!entry || entry.kind !== "render" || entry.manifest.status !== "succeeded") {
        throw new MotionStudioError(
          "NOT_FOUND",
          "Only a successful video render of this production can be approved",
        );
      }
      const manifest = entry.manifest;
      // manifestPath is repository-relative; re-resolve it inside the production folder.
      const manifestRelative = path
        .relative(dir, path.join(this.#workspace.repoRoot, entry.manifestPath))
        .split(path.sep)
        .join("/");
      const manifestFile = this.#workspace.policy.resolveRelative(dir, manifestRelative);
      const problems = await checkOutputs(this.#workspace, dir, manifest);
      if (problems.length > 0) {
        throw new MotionStudioError(
          "INVALID_INPUT",
          `This render cannot be approved: ${problems.join("; ")}`,
        );
      }
      const approval = renderApprovalSchema.parse({
        schemaVersion: 1,
        productionId,
        renderId: manifest.renderId,
        profileId: manifest.profileId,
        inputFingerprint: manifest.inputFingerprint,
        manifest: {
          relativePath: manifestRelative,
          sha256: await hashFile(manifestFile),
        },
        video: { relativePath: manifest.video.relativePath, sha256: manifest.video.sha256 },
        ...(manifest.poster
          ? {
              poster: {
                relativePath: manifest.poster.relativePath,
                sha256: manifest.poster.sha256,
              },
            }
          : {}),
        approvedAt: this.#workspace.timestamp(),
        ...(input.note ? { note: input.note } : {}),
      } satisfies RenderApproval);
      await mkdir(path.dirname(file), { recursive: true });
      this.#workspace.policy.assertAllowed(file);
      await writeFileAtomic(file, serializeJson(approval));
      return this.status(productionId);
    });
  }

  /** Withdraw the approval. The render and its manifest are kept. */
  async remove(productionId: string, rawInput: unknown): Promise<ApprovalStatus> {
    const input = parseInput(renderApprovalRemoveSchema, rawInput, "approval");
    const { dir } = await this.#workspace.locate("production", productionId);
    const file = this.#file(dir);
    return this.#mutex.run(file, async () => {
      await this.#assertUnchanged(file, input.baseHash);
      await rm(file, { force: true });
      return this.status(productionId);
    });
  }

  /**
   * Move finished renders (manifest, video and poster) into the archive,
   * keeping their paths below the production folder so they can be moved
   * back. The approved render cannot be archived; withdraw its approval first.
   */
  async archiveRenders(productionId: string, rawInput: unknown): Promise<RenderArchiveResult> {
    const input = parseInput(renderArchiveInputSchema, rawInput, "archive request");
    const { dir, record } = await this.#workspace.locate("production", productionId);
    const production = record as ProductionRecord;
    // Same lock as approving, so a render cannot be approved while it is being archived.
    return this.#mutex.run(this.#file(dir), async () => {
      const approvedId = await approvedRenderId(this.#file(dir));
      if (approvedId !== undefined && input.renderIds.includes(approvedId)) {
        throw new MotionStudioError(
          "IN_USE",
          `${approvedId} is the approved render. Withdraw the approval before archiving it.`,
        );
      }
      const { outputs } = await this.#renders.history(productionId);
      const moves: string[] = [];
      for (const renderId of input.renderIds) {
        const entry = outputs.find((output) => output.manifest.renderId === renderId);
        if (!entry)
          throw new MotionStudioError(
            "NOT_FOUND",
            `${renderId} is not a render of this production`,
          );
        // The manifest moves first: if anything fails part-way, no manifest is
        // left naming files that have gone.
        moves.push(
          path
            .relative(dir, path.join(this.#workspace.repoRoot, entry.manifestPath))
            .split(path.sep)
            .join("/"),
        );
        if (entry.kind === "render") moves.push(entry.manifest.video.relativePath);
        if (entry.manifest.poster) moves.push(entry.manifest.poster.relativePath);
      }

      const destination = await this.#claimArchiveFolder(production);
      const moved: string[] = [];
      for (const relative of moves) {
        const source = this.#workspace.policy.resolveRelative(dir, relative);
        const target = this.#workspace.policy.resolveRelative(destination, relative);
        await mkdir(path.dirname(target), { recursive: true });
        try {
          await rename(source, target);
          moved.push(relative);
        } catch (error) {
          // An output already missing from disk has nothing to move.
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      await writeFileAtomic(
        path.join(destination, "archive.json"),
        serializeJson({
          schemaVersion: CURRENT_SCHEMA_VERSION,
          scope: "renders",
          productionId,
          slug: production.slug,
          originalPath: toRepoRelative(this.#workspace.repoRoot, dir),
          renderIds: input.renderIds,
          files: moved,
          archivedAt: this.#workspace.timestamp(),
        }),
      );
      return {
        archivedPath: toRepoRelative(this.#workspace.repoRoot, destination),
        renderIds: input.renderIds,
        files: moved,
      };
    });
  }

  async #claimArchiveFolder(production: ProductionRecord): Promise<string> {
    const root = this.#workspace.archiveRoot;
    await mkdir(root, { recursive: true });
    const base = `${formatStamp(this.#workspace.now())}_renders_${production.slug}-${production.id.slice(-8)}`;
    for (let attempt = 1; attempt <= 50; attempt += 1) {
      const folder = this.#workspace.policy.resolve(
        root,
        attempt === 1 ? base : `${base}-${attempt}`,
      );
      try {
        await mkdir(folder);
        return folder;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
    }
    throw new MotionStudioError("ALREADY_EXISTS", "Could not create an archive folder");
  }

  #file(productionDir: string): string {
    return this.#workspace.policy.resolve(productionDir, "renders", APPROVAL_FILE);
  }

  async #assertUnchanged(file: string, baseHash: string): Promise<void> {
    if (hashContent(await readOptional(file)) !== baseHash) {
      throw new MotionStudioError(
        "REVISION_CONFLICT",
        "The approval was changed elsewhere since you loaded it. Check the latest approval and try again.",
      );
    }
  }

  async #verify(dir: string, productionId: string, approval: RenderApproval): Promise<string[]> {
    if (approval.productionId !== productionId)
      return ["approved.json belongs to a different production"];
    let manifestFile: string;
    try {
      manifestFile = this.#workspace.policy.resolveRelative(dir, approval.manifest.relativePath);
    } catch {
      return [`Manifest path ${approval.manifest.relativePath} is not allowed`];
    }
    let manifest: RenderManifest;
    try {
      const raw = await readFile(manifestFile, "utf8");
      if (hashContent(raw) !== approval.manifest.sha256)
        return [`The manifest ${approval.manifest.relativePath} changed after approval`];
      manifest = renderManifestSchema.parse(JSON.parse(raw));
    } catch {
      return [`The manifest ${approval.manifest.relativePath} is missing or invalid`];
    }
    if (
      manifest.renderId !== approval.renderId ||
      manifest.video.relativePath !== approval.video.relativePath ||
      manifest.video.sha256 !== approval.video.sha256
    ) {
      return ["approved.json does not match the manifest it names"];
    }
    return checkOutputs(this.#workspace, dir, manifest);
  }

  async #currentFingerprint(productionId: string, profileId: string): Promise<string | undefined> {
    const profile = this.#workspace.settings.renderProfiles.find((p) => p.id === profileId);
    if (!profile) return undefined;
    try {
      return computeFingerprint(
        await gatherFingerprintInputs(this.#workspace, this.#assets, productionId, profile),
      );
    } catch {
      // Invalid props and similar problems are preflight's to report.
      return undefined;
    }
  }
}

/** Check a manifest's video and poster are present and unchanged. */
async function checkOutputs(
  workspace: WorkspaceService,
  dir: string,
  manifest: RenderManifest,
): Promise<string[]> {
  const problems: string[] = [];
  const files = [
    { label: "video", ...manifest.video },
    ...(manifest.poster ? [{ label: "poster", ...manifest.poster }] : []),
  ];
  for (const output of files) {
    let hash: string | undefined;
    try {
      hash = await hashFile(workspace.policy.resolveRelative(dir, output.relativePath));
    } catch {
      hash = undefined;
    }
    if (hash === undefined) problems.push(`The ${output.label} ${output.relativePath} is missing`);
    else if (hash !== output.sha256)
      problems.push(`The ${output.label} ${output.relativePath} changed after rendering`);
  }
  return problems;
}

/** The render named by approved.json, even when the rest of the file is invalid. */
async function approvedRenderId(file: string): Promise<string | undefined> {
  try {
    const data: unknown = JSON.parse(await readOptional(file));
    if (data && typeof data === "object" && "renderId" in data && typeof data.renderId === "string")
      return data.renderId;
  } catch {
    // Missing or unreadable: nothing is approved.
  }
  return undefined;
}

async function readOptional(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}
