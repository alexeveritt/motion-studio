import { createHash, randomBytes } from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import {
  link,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import type { Catalog, CatalogIssue } from "./catalog.ts";
import { MotionStudioError } from "./errors.ts";
import { KeyedMutex, serializeJson, writeFileExclusive, writeJsonAtomic } from "./fs-store.ts";
import { newId } from "./ids.ts";
import {
  detectMedia,
  extensionOf,
  formatBytes,
  MAX_SVG_BYTES,
  SNIFF_BYTES,
  stripExtension,
  svgProblems,
  type DetectedMedia,
} from "./media.ts";
import { assertSafeSegment } from "./paths.ts";
import { toRepoRelative } from "./repo.ts";
import { assetRecordSchema, type AssetRecord } from "./schemas/asset.ts";
import { CURRENT_SCHEMA_VERSION } from "./schemas/common.ts";
import {
  assetArchiveInputSchema,
  assetMetadataInputSchema,
  assetRegisterInputSchema,
  type AssetScope,
  type Scope,
} from "./schemas/inputs.ts";
import { parseInput, parseRecord } from "./schemas/parse.ts";
import { slugify } from "./slug.ts";
import { formatStamp, hashContent, slugCandidates, type WorkspaceService } from "./workspace.ts";

export const SIDECAR_SUFFIX = ".asset.json";

const ASSET_FOLDERS: Record<AssetScope, { scope: Scope; folder: string[] }> = {
  project: { scope: "project", folder: ["assets"] },
  brand: { scope: "project", folder: ["brand", "assets"] },
  campaign: { scope: "campaign", folder: ["assets"] },
  production: { scope: "production", folder: ["assets"] },
};

/** Source files scanned for asset usage. */
const SOURCE_EXTENSIONS = new Set(["ts", "tsx", "js", "jsx", "mjs", "css", "json"]);
const MAX_SOURCE_BYTES = 1024 * 1024;

export type AssetStatus = "ok" | "modified" | "missing";

export type AssetEntry = {
  record: AssetRecord;
  /** Repository-relative path of the asset file. */
  path: string;
  /** SHA-256 of the sidecar file, used as the edit base. */
  sidecarHash: string;
  status: AssetStatus;
  /** Repository-relative source files that mention the stored file name. */
  usage: string[];
};

export type AssetListing = {
  scope: AssetScope;
  /** Repository-relative asset folder. */
  folder: string;
  assets: AssetEntry[];
  /** Files in the folder with no sidecar, for example copied in by hand. */
  unregistered: { name: string; path: string }[];
  problems: { path: string; message: string }[];
};

export type UploadSource = {
  originalName: string;
  body: AsyncIterable<Uint8Array>;
};

/**
 * Asset folders and their `<file>.asset.json` sidecars. Uploaded bytes and
 * names are untrusted: names are normalised, types come from content, nothing
 * is ever overwritten and removal means moving to the archive.
 */
export class AssetLibrary {
  readonly #workspace: WorkspaceService;
  readonly #mutex = new KeyedMutex();

  constructor(workspace: WorkspaceService) {
    this.#workspace = workspace;
  }

  async list(assetScope: AssetScope, id: string): Promise<AssetListing> {
    const dir = await this.#folder(assetScope, id);
    const repo = (absolute: string) => toRepoRelative(this.#workspace.repoRoot, absolute);
    const usageSources = await this.#usageSources(assetScope, id);
    const listing: AssetListing = {
      scope: assetScope,
      folder: repo(dir),
      assets: [],
      unregistered: [],
      problems: [],
    };

    const entries = await safeReaddir(dir);
    const names = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const described = new Set<string>();

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isSymbolicLink()) {
        listing.problems.push({
          path: repo(path.join(dir, entry.name)),
          message: "Symbolic links are ignored",
        });
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(SIDECAR_SUFFIX)) continue;
      const sidecarFile = path.join(dir, entry.name);
      try {
        const raw = await readFile(sidecarFile, "utf8");
        const record = parseRecord(assetRecordSchema, JSON.parse(raw), "asset");
        if (`${record.storedName}${SIDECAR_SUFFIX}` !== entry.name) {
          throw new MotionStudioError(
            "SCHEMA_INVALID",
            `storedName "${record.storedName}" does not match the sidecar name`,
          );
        }
        assertSafeSegment(record.storedName);
        described.add(record.storedName);
        const file = path.join(dir, record.storedName);
        const status: AssetStatus = !names.has(record.storedName)
          ? "missing"
          : (await hashFile(file)) === record.sha256
            ? "ok"
            : "modified";
        listing.assets.push({
          record,
          path: repo(file),
          sidecarHash: hashContent(raw),
          status,
          usage: usageOf(record.storedName, usageSources),
        });
      } catch (error) {
        listing.problems.push({
          path: repo(sidecarFile),
          message: error instanceof MotionStudioError ? error.message : "Sidecar is not valid JSON",
        });
      }
    }

    for (const name of [...names].sort()) {
      if (name.startsWith(".") || name.endsWith(SIDECAR_SUFFIX) || described.has(name)) continue;
      listing.unregistered.push({ name, path: repo(path.join(dir, name)) });
    }
    listing.assets.sort((a, b) => a.record.storedName.localeCompare(b.record.storedName));
    return listing;
  }

  /** Stream an upload into staging, validate it and store it with a new sidecar. */
  async upload(assetScope: AssetScope, id: string, source: UploadSource): Promise<AssetEntry> {
    const originalName = cleanOriginalName(source.originalName);
    const dir = await this.#folder(assetScope, id);
    const staged = await this.#stage(source.body);
    try {
      return await this.#mutex.run(dir, async () => {
        const assetId = newId();
        const facts = await this.#inspect(
          staged.file,
          originalName,
          staged.bytes,
          dir,
          assetScope,
          id,
        );
        const base = slugify(stripExtension(originalName)) || "asset";
        const storedName = await this.#claimName(dir, base, facts.extension, assetId, staged.file);
        const record = this.#record(assetId, originalName, storedName, facts, staged);
        await this.#writeSidecar(dir, record, path.join(dir, storedName));
        return this.#entry(assetScope, id, dir, record);
      });
    } finally {
      await rm(staged.file, { force: true });
    }
  }

  /** Create a sidecar for a file that was copied into the asset folder by hand. */
  async register(assetScope: AssetScope, id: string, rawInput: unknown): Promise<AssetEntry> {
    const { fileName } = parseInput(assetRegisterInputSchema, rawInput, "register request");
    const dir = await this.#folder(assetScope, id);
    const file = this.#workspace.policy.resolve(dir, fileName);
    if (fileName.endsWith(SIDECAR_SUFFIX))
      throw new MotionStudioError("INVALID_INPUT", "Sidecar files cannot be registered");
    return this.#mutex.run(dir, async () => {
      const stats = await lstat(file).catch(() => undefined);
      if (!stats?.isFile())
        throw new MotionStudioError("NOT_FOUND", `${fileName} is not a file in this folder`);
      if (await exists(`${file}${SIDECAR_SUFFIX}`))
        throw new MotionStudioError("ALREADY_EXISTS", `${fileName} is already registered`);
      this.#assertUploadSize(stats.size);
      const sha256 = await hashFile(file);
      const facts = await this.#inspect(file, fileName, stats.size, dir, assetScope, id, {
        sha256,
        alreadyInProject: true,
      });
      if (!extensionMatches(extensionOf(fileName), facts.extension)) {
        throw new MotionStudioError(
          "UNSUPPORTED_MEDIA",
          `${fileName} contains ${facts.mimeType} data; rename it to end in .${facts.extension} first`,
        );
      }
      const record = this.#record(newId(), fileName, fileName, facts, {
        sha256,
        bytes: stats.size,
      });
      await this.#writeSidecar(dir, record);
      return this.#entry(assetScope, id, dir, record);
    });
  }

  /** Update alt text, source and licence notes. Rejects stale edits by sidecar hash. */
  async updateMetadata(
    assetScope: AssetScope,
    id: string,
    assetId: string,
    rawInput: unknown,
  ): Promise<AssetEntry> {
    const input = parseInput(assetMetadataInputSchema, rawInput, "asset metadata");
    const dir = await this.#folder(assetScope, id);
    return this.#mutex.run(dir, async () => {
      const { record, sidecar, raw } = await this.#find(dir, assetId);
      if (hashContent(raw) !== input.baseHash) {
        throw new MotionStudioError(
          "REVISION_CONFLICT",
          "This asset's details changed since you opened them. Reload and try again.",
        );
      }
      const next: AssetRecord = { ...record };
      for (const key of ["altText", "source", "licenceNotes"] as const) {
        const value = input[key];
        if (value === undefined) continue;
        if (value === "") delete next[key];
        else next[key] = value;
      }
      await writeJsonAtomic(sidecar, parseRecord(assetRecordSchema, next, "asset"));
      return this.#entry(assetScope, id, dir, next);
    });
  }

  /**
   * Move an asset and its sidecar into the archive. Refused while any source
   * file still mentions it. The operator confirms with the stored file name.
   */
  async archive(
    assetScope: AssetScope,
    id: string,
    assetId: string,
    rawInput: unknown,
  ): Promise<{ archivedPath: string }> {
    const { confirmName } = parseInput(assetArchiveInputSchema, rawInput, "archive request");
    const dir = await this.#folder(assetScope, id);
    return this.#mutex.run(dir, async () => {
      const { record, sidecar } = await this.#find(dir, assetId);
      if (confirmName !== record.storedName) {
        throw new MotionStudioError(
          "CONFIRMATION_REQUIRED",
          `Type "${record.storedName}" to confirm`,
        );
      }
      const usage = usageOf(record.storedName, await this.#usageSources(assetScope, id));
      if (usage.length > 0) {
        throw new MotionStudioError(
          "IN_USE",
          `${record.storedName} is still used by ${usage.join(", ")}`,
        );
      }
      const workspace = this.#workspace;
      const destination = workspace.policy.resolve(
        workspace.archiveRoot,
        `${formatStamp(workspace.now())}_asset_${record.storedName}-${assetId.slice(-8)}`,
      );
      await mkdir(destination, { recursive: true });
      const file = path.join(dir, record.storedName);
      if (await exists(file)) await rename(file, path.join(destination, record.storedName));
      await rename(sidecar, path.join(destination, `${record.storedName}${SIDECAR_SUFFIX}`));
      await writeJsonAtomic(path.join(destination, "archive.json"), {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        scope: "asset",
        id: assetId,
        originalPath: toRepoRelative(workspace.repoRoot, file),
        archivedAt: workspace.timestamp(),
      });
      return { archivedPath: toRepoRelative(workspace.repoRoot, destination) };
    });
  }

  /** Resolve an asset file for serving. */
  async open(
    assetScope: AssetScope,
    id: string,
    assetId: string,
  ): Promise<{ file: string; record: AssetRecord }> {
    const dir = await this.#folder(assetScope, id);
    const { record } = await this.#find(dir, assetId);
    const file = this.#workspace.policy.resolve(dir, record.storedName);
    if (!(await exists(file)))
      throw new MotionStudioError("NOT_FOUND", `${record.storedName} is missing`);
    return { file, record };
  }

  /**
   * Resolve a composition's asset reference ("brand:logo.svg") for a
   * production: the scope picks the folder in the production's chain and the
   * name must be a registered asset there.
   */
  async openForProduction(
    productionId: string,
    assetScope: AssetScope,
    storedName: string,
  ): Promise<{ file: string; record: AssetRecord }> {
    assertSafeSegment(storedName);
    const catalog = await this.#workspace.scan();
    for (const project of catalog.projects) {
      for (const campaign of project.campaigns) {
        if (!campaign.productions.some((production) => production.record.id === productionId))
          continue;
        const ownerId =
          assetScope === "production"
            ? productionId
            : assetScope === "campaign"
              ? campaign.record.id
              : project.record.id;
        const dir = await this.#folder(assetScope, ownerId);
        const sidecar = this.#workspace.policy.resolve(dir, `${storedName}${SIDECAR_SUFFIX}`);
        let record: AssetRecord;
        try {
          record = parseRecord(
            assetRecordSchema,
            JSON.parse(await readFile(sidecar, "utf8")),
            "asset",
          );
        } catch {
          throw new MotionStudioError(
            "NOT_FOUND",
            `No registered ${assetScope} asset named ${storedName}`,
          );
        }
        if (record.storedName !== storedName)
          throw new MotionStudioError(
            "NOT_FOUND",
            `No registered ${assetScope} asset named ${storedName}`,
          );
        const file = this.#workspace.policy.resolve(dir, storedName);
        if (!(await exists(file)))
          throw new MotionStudioError("NOT_FOUND", `${storedName} is missing`);
        return { file, record };
      }
    }
    throw new MotionStudioError("NOT_FOUND", "The production was not found");
  }

  /** Validate every asset folder in the catalog. Used by `pnpm validate:workspace`. */
  async validate(catalog: Catalog): Promise<CatalogIssue[]> {
    const issues: CatalogIssue[] = [];
    const folders: [AssetScope, string][] = catalog.projects.flatMap((project) => [
      ["project", project.record.id] as [AssetScope, string],
      ["brand", project.record.id] as [AssetScope, string],
      ...project.campaigns.flatMap((campaign) => [
        ["campaign", campaign.record.id] as [AssetScope, string],
        ...campaign.productions.map(
          (production) => ["production", production.record.id] as [AssetScope, string],
        ),
      ]),
    ]);
    for (const [assetScope, id] of folders) {
      const listing = await this.list(assetScope, id);
      for (const problem of listing.problems) {
        issues.push({
          severity: "error",
          code: "SCHEMA_INVALID",
          path: problem.path,
          message: problem.message,
        });
      }
      for (const asset of listing.assets) {
        if (asset.status === "missing") {
          issues.push({
            severity: "error",
            code: "NOT_FOUND",
            path: asset.path,
            message: "Asset file is missing",
          });
        } else if (asset.status === "modified") {
          issues.push({
            severity: "error",
            code: "SCHEMA_INVALID",
            path: asset.path,
            message:
              "File no longer matches the SHA-256 in its sidecar. Re-upload it as a new asset.",
          });
        }
      }
      for (const file of listing.unregistered) {
        issues.push({
          severity: "warning",
          code: "RECORD_MISSING",
          path: file.path,
          message: "File has no .asset.json sidecar",
        });
      }
    }
    return issues;
  }

  // ---------------------------------------------------------------- helpers

  async #folder(assetScope: AssetScope, id: string): Promise<string> {
    const { scope, folder } = ASSET_FOLDERS[assetScope];
    const { dir } = await this.#workspace.locate(scope, id);
    return this.#workspace.policy.resolve(dir, ...folder);
  }

  async #stage(
    body: AsyncIterable<Uint8Array>,
  ): Promise<{ file: string; bytes: number; sha256: string }> {
    const stagingDir = this.#workspace.policy.resolve(this.#workspace.tmpRoot, "uploads");
    await mkdir(stagingDir, { recursive: true });
    const file = path.join(stagingDir, `${randomBytes(12).toString("hex")}.part`);
    const limit = this.#workspace.settings.limits.maxUploadBytes;
    const hash = createHash("sha256");
    let bytes = 0;
    const handle = await open(file, "wx", 0o600);
    try {
      for await (const chunk of body) {
        bytes += chunk.byteLength;
        if (bytes > limit) throw limitError(limit);
        hash.update(chunk);
        await handle.write(chunk);
      }
      await handle.sync();
    } catch (error) {
      await handle.close();
      await rm(file, { force: true });
      throw error;
    }
    await handle.close();
    if (bytes === 0) {
      await rm(file, { force: true });
      throw new MotionStudioError("INVALID_INPUT", "The file is empty");
    }
    return { file, bytes, sha256: hash.digest("hex") };
  }

  /** Detect the type, apply content rules and check duplicates and size limits. */
  async #inspect(
    file: string,
    originalName: string,
    bytes: number,
    dir: string,
    assetScope: AssetScope,
    id: string,
    options: { sha256?: string; alreadyInProject?: boolean } = {},
  ): Promise<DetectedMedia> {
    const head = await readHead(file, SNIFF_BYTES);
    const facts = detectMedia(head, originalName);
    if (!facts) {
      throw new MotionStudioError(
        "UNSUPPORTED_MEDIA",
        "Unsupported file type. Allowed: PNG, JPEG, GIF, WebP, SVG, MP3, WAV, OGG, M4A, MP4, MOV, WebM, WOFF, WOFF2, TTF, OTF, PDF, TXT and Markdown.",
      );
    }
    if (facts.mimeType === "image/svg+xml") {
      if (bytes > MAX_SVG_BYTES)
        throw new MotionStudioError("LIMIT_EXCEEDED", "SVG files are limited to 5 MB");
      const problems = svgProblems(await readFile(file, "utf8"));
      if (problems.length > 0) {
        throw new MotionStudioError(
          "UNSUPPORTED_MEDIA",
          `SVG rejected for safety: it ${problems.join(", ")}. Export a plain SVG or a PNG.`,
        );
      }
    }
    if (options.sha256) await this.#assertNotDuplicate(dir, options.sha256);
    else await this.#assertNotDuplicate(dir, await hashFile(file));
    if (!options.alreadyInProject) await this.#assertProjectSize(assetScope, id, bytes);
    return facts;
  }

  async #assertNotDuplicate(dir: string, sha256: string): Promise<void> {
    for (const entry of await safeReaddir(dir)) {
      if (!entry.isFile() || !entry.name.endsWith(SIDECAR_SUFFIX)) continue;
      try {
        const record = assetRecordSchema.parse(
          JSON.parse(await readFile(path.join(dir, entry.name), "utf8")),
        );
        if (record.sha256 === sha256) {
          throw new MotionStudioError(
            "ALREADY_EXISTS",
            `An identical file is already stored as ${record.storedName}`,
          );
        }
      } catch (error) {
        if (error instanceof MotionStudioError) throw error;
      }
    }
  }

  async #assertProjectSize(assetScope: AssetScope, id: string, adding: number): Promise<void> {
    const { scope } = ASSET_FOLDERS[assetScope];
    const catalog = await this.#workspace.scan();
    const project = catalog.projects.find((entry) =>
      scope === "project"
        ? entry.record.id === id
        : entry.campaigns.some(
            (campaign) =>
              campaign.record.id === id ||
              campaign.productions.some((production) => production.record.id === id),
          ),
    );
    if (!project) return;
    const limit = this.#workspace.settings.limits.maxProjectBytes;
    const used = await directorySize(
      path.join(this.#workspace.repoRoot, ...project.path.split("/")),
    );
    if (used + adding > limit) {
      throw new MotionStudioError(
        "LIMIT_EXCEEDED",
        `This upload would take the project to ${formatBytes(used + adding)}, over the ${formatBytes(limit)} limit in settings`,
      );
    }
  }

  #assertUploadSize(bytes: number): void {
    const limit = this.#workspace.settings.limits.maxUploadBytes;
    if (bytes > limit) throw limitError(limit);
  }

  /**
   * Hard-link the staged file into place under the first free name. link()
   * fails if the target exists, so nothing is ever overwritten.
   */
  async #claimName(
    dir: string,
    base: string,
    extension: string,
    assetId: string,
    staged: string,
  ): Promise<string> {
    await mkdir(dir, { recursive: true });
    for (const candidate of slugCandidates(base, assetId)) {
      const name = `${candidate}.${extension}`;
      const target = this.#workspace.policy.resolve(dir, name);
      if (await exists(`${target}${SIDECAR_SUFFIX}`)) continue;
      try {
        await link(staged, target);
        return name;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue;
        throw error;
      }
    }
    throw new MotionStudioError("ALREADY_EXISTS", "Could not find a free file name");
  }

  #record(
    assetId: string,
    originalName: string,
    storedName: string,
    facts: DetectedMedia,
    content: { sha256: string; bytes: number },
  ): AssetRecord {
    return parseRecord(
      assetRecordSchema,
      {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        id: assetId,
        originalName,
        storedName,
        mediaType: facts.mediaType,
        mimeType: facts.mimeType,
        bytes: content.bytes,
        sha256: content.sha256,
        ...(facts.width && facts.height ? { width: facts.width, height: facts.height } : {}),
        createdAt: this.#workspace.timestamp(),
      },
      "asset",
    );
  }

  /** Write a new sidecar. If that fails, remove the just-stored file so no orphan is left. */
  async #writeSidecar(dir: string, record: AssetRecord, removeOnFailure?: string): Promise<void> {
    const sidecar = this.#workspace.policy.resolve(dir, `${record.storedName}${SIDECAR_SUFFIX}`);
    try {
      await writeFileExclusive(sidecar, serializeJson(record));
    } catch (error) {
      if (removeOnFailure) await unlink(removeOnFailure).catch(() => undefined);
      throw error;
    }
  }

  async #entry(
    assetScope: AssetScope,
    id: string,
    dir: string,
    record: AssetRecord,
  ): Promise<AssetEntry> {
    const raw = await readFile(path.join(dir, `${record.storedName}${SIDECAR_SUFFIX}`), "utf8");
    return {
      record,
      path: toRepoRelative(this.#workspace.repoRoot, path.join(dir, record.storedName)),
      sidecarHash: hashContent(raw),
      status: "ok",
      usage: usageOf(record.storedName, await this.#usageSources(assetScope, id)),
    };
  }

  async #find(
    dir: string,
    assetId: string,
  ): Promise<{ record: AssetRecord; sidecar: string; raw: string }> {
    for (const entry of await safeReaddir(dir)) {
      if (!entry.isFile() || !entry.name.endsWith(SIDECAR_SUFFIX)) continue;
      const sidecar = path.join(dir, entry.name);
      const raw = await readFile(sidecar, "utf8");
      let record: AssetRecord;
      try {
        record = assetRecordSchema.parse(JSON.parse(raw));
      } catch {
        continue;
      }
      if (record.id === assetId && `${record.storedName}${SIDECAR_SUFFIX}` === entry.name) {
        assertSafeSegment(record.storedName);
        return { record, sidecar, raw };
      }
    }
    throw new MotionStudioError("NOT_FOUND", "Asset not found");
  }

  /**
   * Source files that could reference assets in this scope: the production's
   * own src/ and tests/, or those of every production beneath a campaign or
   * project.
   */
  async #usageSources(assetScope: AssetScope, id: string): Promise<Map<string, string>> {
    const catalog = await this.#workspace.scan();
    const relevant = catalog.projects.flatMap((project) =>
      project.campaigns.flatMap((campaign) =>
        campaign.productions.filter((production) => {
          if (assetScope === "production") return production.record.id === id;
          if (assetScope === "campaign") return campaign.record.id === id;
          return project.record.id === id;
        }),
      ),
    );
    const sources = new Map<string, string>();
    for (const production of relevant) {
      const dir = path.join(this.#workspace.repoRoot, ...production.path.split("/"));
      for (const sub of ["src", "tests"]) {
        for (const file of await walkSourceFiles(path.join(dir, sub))) {
          sources.set(toRepoRelative(this.#workspace.repoRoot, file), await readFile(file, "utf8"));
        }
      }
    }
    return sources;
  }
}

// ------------------------------------------------------------------ helpers

function usageOf(storedName: string, sources: Map<string, string>): string[] {
  return [...sources].filter(([, content]) => content.includes(storedName)).map(([file]) => file);
}

async function walkSourceFiles(dir: string, depth = 0): Promise<string[]> {
  if (depth > 8) return [];
  const results: string[] = [];
  for (const entry of await safeReaddir(dir)) {
    if (entry.name.startsWith(".") || entry.isSymbolicLink() || entry.name === "node_modules")
      continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...(await walkSourceFiles(full, depth + 1)));
    else if (entry.isFile() && SOURCE_EXTENSIONS.has(extensionOf(entry.name))) {
      if ((await stat(full)).size <= MAX_SOURCE_BYTES) results.push(full);
    }
  }
  return results.sort();
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await safeReaddir(dir)) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) total += await directorySize(full);
    else if (entry.isFile()) total += (await stat(full)).size;
  }
  return total;
}

async function safeReaddir(dir: string): Promise<Dirent[]> {
  try {
    return (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  } catch {
    return [];
  }
}

async function exists(file: string): Promise<boolean> {
  return lstat(file).then(
    () => true,
    () => false,
  );
}

export async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function readHead(file: string, bytes: number): Promise<Uint8Array> {
  const handle = await open(file, "r");
  try {
    const buffer = new Uint8Array(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

// eslint-disable-next-line no-control-regex
const NAME_CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** Keep only the final path component of a browser-supplied name and reject control characters. */
export function cleanOriginalName(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() ?? "";
  if (
    base === "" ||
    base === "." ||
    base === ".." ||
    base.length > 255 ||
    NAME_CONTROL_CHARACTERS.test(base)
  ) {
    throw new MotionStudioError("INVALID_INPUT", "The file name is not usable");
  }
  return base;
}

function extensionMatches(actual: string, canonical: string): boolean {
  const aliases: Record<string, string[]> = {
    jpg: ["jpg", "jpeg"],
    md: ["md", "markdown"],
    mov: ["mov", "qt"],
  };
  return (aliases[canonical] ?? [canonical]).includes(actual);
}

function limitError(limit: number): MotionStudioError {
  return new MotionStudioError(
    "LIMIT_EXCEEDED",
    `Uploads are limited to ${formatBytes(limit)} (settings.limits.maxUploadBytes)`,
  );
}
