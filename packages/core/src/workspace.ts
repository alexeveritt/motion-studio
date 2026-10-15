import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { scanCatalog, type Catalog, type CampaignEntry, type ProjectEntry } from "./catalog.ts";
import { MotionStudioError } from "./errors.ts";
import {
  createDirectoryExclusive,
  KeyedMutex,
  readJsonRecord,
  serializeJson,
  writeFileAtomic,
  writeFileExclusive,
  writeJsonAtomic,
} from "./fs-store.ts";
import { newId } from "./ids.ts";
import { PathPolicy } from "./paths.ts";
import { isInside, toRepoRelative } from "./repo.ts";
import { campaignRecordSchema, type CampaignRecord } from "./schemas/campaign.ts";
import { CURRENT_SCHEMA_VERSION, recordId } from "./schemas/common.ts";
import {
  archiveInputSchema,
  campaignCreateInputSchema,
  campaignUpdateInputSchema,
  documentPath,
  documentSaveInputSchema,
  productionCreateInputSchema,
  productionUpdateInputSchema,
  projectCreateInputSchema,
  projectUpdateInputSchema,
  type Scope,
} from "./schemas/inputs.ts";
import { parseInput, SchemaValidationError, type FieldIssue } from "./schemas/parse.ts";
import {
  productionRecordSchema,
  type ProductionFormat,
  type ProductionRecord,
} from "./schemas/production.ts";
import { projectRecordSchema, type ProjectRecord } from "./schemas/project.ts";
import type { Settings } from "./schemas/settings.ts";
import { SLUG_MAX_LENGTH, slugify } from "./slug.ts";
import {
  parsePropsSchema,
  PROPS_SCHEMA_FILE,
  validateProps,
  type PropsSchema,
} from "./props-schema.ts";
import {
  brandTemplate,
  productionCompositionTemplate,
  productionPropsSchemaTemplate,
  campaignBriefTemplate,
  productionBriefTemplate,
  productionNotesTemplate,
  productionPromptTemplate,
  projectContextTemplate,
} from "./templates.ts";

export type WorkspaceOptions = {
  repoRoot: string;
  workspaceRoot: string;
  settings: Settings;
  /** Injectable clock for tests. */
  now?: () => Date;
  /** Render job folder; defaults to .motion-studio/jobs. Tests point this at a scratch folder. */
  jobsRoot?: string;
};

export type DocumentContent = {
  content: string;
  hash: string;
  exists: boolean;
  /** Repository-relative path. */
  path: string;
};

const RECORD_FILES = {
  project: "project.json",
  campaign: "campaign.json",
  production: "production.json",
} as const satisfies Record<Scope, string>;

const RECORD_SCHEMAS = {
  project: projectRecordSchema,
  campaign: campaignRecordSchema,
  production: productionRecordSchema,
} as const;

const KEEP = ".gitkeep";
const PROPS_FILE = "props.json";
const MAX_PROPS_BYTES = 256 * 1024;

export type PropsSchemaFile = {
  /** Repository-relative path of props.schema.json. */
  path: string;
  exists: boolean;
  raw?: string;
  schema?: PropsSchema;
  /** Problems with the schema itself. */
  issues: FieldIssue[];
};

export type ProductionPropsCheck = {
  props: ProductionProps;
  schema: PropsSchemaFile;
  /** Props that do not satisfy a valid schema, keyed by property name. */
  propsIssues: FieldIssue[];
};

export type ProductionProps = {
  /** Repository-relative path of props.json. */
  path: string;
  exists: boolean;
  props: Record<string, unknown>;
  error?: string;
};

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * All mutations of workspace records go through this service. It resolves
 * every path through the PathPolicy, writes atomically, serialises writes per
 * file and rejects stale revisions.
 */
export class WorkspaceService {
  readonly repoRoot: string;
  readonly workspaceRoot: string;
  /** Removed records are moved here, never deleted. Sibling of the projects folder. */
  readonly archiveRoot: string;
  /** Gitignored scratch space: upload staging and prompt candidates. */
  readonly tmpRoot: string;
  /** Gitignored, rebuildable derived files such as the composition registry. */
  readonly cacheRoot: string;
  /** Gitignored, ephemeral render job state, logs and partial outputs. */
  readonly jobsRoot: string;
  readonly settings: Settings;
  readonly policy: PathPolicy;
  readonly #now: () => Date;
  readonly #mutex = new KeyedMutex();

  constructor({ repoRoot, workspaceRoot, settings, now, jobsRoot }: WorkspaceOptions) {
    this.repoRoot = repoRoot;
    this.workspaceRoot = workspaceRoot;
    this.archiveRoot = path.join(path.dirname(workspaceRoot), "archive");
    if (!isInside(repoRoot, this.archiveRoot)) {
      throw new MotionStudioError(
        "PATH_OUTSIDE_ROOT",
        "The archive folder would be outside the repository",
      );
    }
    this.tmpRoot = path.join(repoRoot, ".motion-studio", "tmp");
    this.cacheRoot = path.join(repoRoot, ".motion-studio", "cache");
    this.jobsRoot = jobsRoot ?? path.join(repoRoot, ".motion-studio", "jobs");
    if (!isInside(repoRoot, this.jobsRoot)) {
      throw new MotionStudioError(
        "PATH_OUTSIDE_ROOT",
        "The jobs folder must be inside the repository",
      );
    }
    this.settings = settings;
    this.policy = new PathPolicy([
      workspaceRoot,
      this.archiveRoot,
      this.tmpRoot,
      this.cacheRoot,
      this.jobsRoot,
    ]);
    this.#now = now ?? (() => new Date());
  }

  scan(): Promise<Catalog> {
    return scanCatalog({
      repoRoot: this.repoRoot,
      workspaceRoot: this.workspaceRoot,
      settings: this.settings,
    });
  }

  // ---------------------------------------------------------------- projects

  async createProject(rawInput: unknown): Promise<ProjectRecord> {
    const input = parseInput(projectCreateInputSchema, rawInput, "project");
    const profileId = input.defaultRenderProfileId ?? this.settings.defaultRenderProfileId;
    this.#assertProfile(profileId, "defaultRenderProfileId");

    const id = newId();
    const timestamp = this.#timestamp();
    return this.#mutex.run(this.workspaceRoot, () =>
      this.#createIn(
        this.workspaceRoot,
        input.slug ?? slugify(input.name),
        id,
        "name",
        async (dir, slug) => {
          const record = parseInput(
            projectRecordSchema,
            {
              schemaVersion: CURRENT_SCHEMA_VERSION,
              id,
              slug,
              name: input.name,
              description: input.description,
              status: "active",
              ...(input.sourceRepository ? { sourceRepository: input.sourceRepository } : {}),
              defaultRenderProfileId: profileId,
              contextFile: "context.md",
              brandFile: "brand/brand.md",
              createdAt: timestamp,
              updatedAt: timestamp,
              revision: 1,
            },
            "project",
          );
          await this.#scaffold(dir, {
            "context.md": projectContextTemplate(record),
            "brand/brand.md": brandTemplate(record),
            [`brand/assets/${KEEP}`]: "",
            [`assets/${KEEP}`]: "",
            [`campaigns/${KEEP}`]: "",
            "project.json": serializeJson(record),
          });
          return record;
        },
      ),
    );
  }

  async updateProject(id: string, rawInput: unknown): Promise<ProjectRecord> {
    const input = parseInput(projectUpdateInputSchema, rawInput, "project update");
    this.#assertProfile(input.defaultRenderProfileId, "defaultRenderProfileId");
    const { sourceRepository, revision: _revision, ...fields } = input;
    return this.#updateRecord("project", id, input.revision, (current) => {
      const { sourceRepository: _previous, ...rest } = current;
      return { ...rest, ...fields, ...(sourceRepository ? { sourceRepository } : {}) };
    });
  }

  // --------------------------------------------------------------- campaigns

  async createCampaign(projectId: string, rawInput: unknown): Promise<CampaignRecord> {
    const input = parseInput(campaignCreateInputSchema, rawInput, "campaign");
    const project = await this.#findProject(projectId);
    const campaignsDir = this.policy.resolve(this.#abs(project.path), "campaigns");

    const id = newId();
    const timestamp = this.#timestamp();
    return this.#mutex.run(campaignsDir, () =>
      this.#createIn(
        campaignsDir,
        input.slug ?? slugify(input.name),
        id,
        "name",
        async (dir, slug) => {
          const record = parseInput(
            campaignRecordSchema,
            {
              schemaVersion: CURRENT_SCHEMA_VERSION,
              id,
              projectId: project.record.id,
              slug,
              name: input.name,
              description: input.description,
              objective: input.objective,
              audience: input.audience,
              keyMessages: input.keyMessages,
              channels: input.channels,
              status: "draft",
              briefFile: "brief.md",
              createdAt: timestamp,
              updatedAt: timestamp,
              revision: 1,
            },
            "campaign",
          );
          await this.#scaffold(dir, {
            "brief.md": campaignBriefTemplate(record),
            [`assets/${KEEP}`]: "",
            [`productions/${KEEP}`]: "",
            "campaign.json": serializeJson(record),
          });
          return record;
        },
      ),
    );
  }

  async updateCampaign(id: string, rawInput: unknown): Promise<CampaignRecord> {
    const input = parseInput(campaignUpdateInputSchema, rawInput, "campaign update");
    const { revision: _revision, ...fields } = input;
    return this.#updateRecord("campaign", id, input.revision, (current) => ({
      ...current,
      ...fields,
    }));
  }

  // ------------------------------------------------------------- productions

  async createProduction(campaignId: string, rawInput: unknown): Promise<ProductionRecord> {
    const input = parseInput(productionCreateInputSchema, rawInput, "production");
    const catalog = await this.scan();
    const { project, campaign } = findCampaign(catalog, campaignId);
    const profileId = input.defaultRenderProfileId ?? project.record.defaultRenderProfileId;
    this.#assertProfile(profileId, "defaultRenderProfileId");
    this.#assertFormatLimits(input.format);
    const posterFrame = input.posterFrame ?? input.format.durationInFrames - 1;
    const productionsDir = this.policy.resolve(this.#abs(campaign.path), "productions");

    const id = newId();
    const timestamp = this.#timestamp();
    // Composition IDs must be unique across the workspace, so serialise all production creates.
    return this.#mutex.run("productions", () =>
      this.#createIn(
        productionsDir,
        input.slug ?? slugify(input.title),
        id,
        "title",
        async (dir, slug) => {
          const takenCompositions = new Set(
            (await this.scan()).projects.flatMap((p) =>
              p.campaigns.flatMap((c) => c.productions.map((entry) => entry.record.compositionId)),
            ),
          );
          const compositionId = uniqueSlug(
            joinSlugs(project.record.slug, slug),
            id,
            takenCompositions,
          );
          const record = parseInput(
            productionRecordSchema,
            {
              schemaVersion: CURRENT_SCHEMA_VERSION,
              id,
              projectId: project.record.id,
              campaignId: campaign.record.id,
              slug,
              title: input.title,
              description: input.description,
              status: "idea",
              compositionId,
              format: input.format,
              files: {
                brief: "brief.md",
                prompt: "prompt.md",
                notes: "notes.md",
                entry: "src/composition.tsx",
              },
              defaultRenderProfileId: profileId,
              posterFrame,
              tags: input.tags,
              createdAt: timestamp,
              updatedAt: timestamp,
              revision: 1,
            },
            "production",
          );
          await this.#scaffold(dir, {
            "brief.md": productionBriefTemplate(record),
            "prompt.md": productionPromptTemplate(project.record, campaign.record, record),
            "notes.md": productionNotesTemplate(record),
            [`assets/${KEEP}`]: "",
            "src/composition.tsx": productionCompositionTemplate(record),
            [PROPS_SCHEMA_FILE]: productionPropsSchemaTemplate(record),
            [`tests/${KEEP}`]: "",
            [`renders/manifests/${KEEP}`]: "",
            [`renders/final/${KEEP}`]: "",
            "production.json": serializeJson(record),
          });
          return record;
        },
      ),
    );
  }

  async updateProduction(id: string, rawInput: unknown): Promise<ProductionRecord> {
    const input = parseInput(productionUpdateInputSchema, rawInput, "production update");
    this.#assertProfile(input.defaultRenderProfileId, "defaultRenderProfileId");
    this.#assertFormatLimits(input.format);
    const { revision: _revision, ...fields } = input;
    return this.#updateRecord("production", id, input.revision, (current) => ({
      ...current,
      ...fields,
    }));
  }

  // --------------------------------------------------------------- documents

  async readDocument(scopeName: Scope, id: string, kind: string): Promise<DocumentContent> {
    const file = await this.#documentFile(scopeName, id, kind);
    let content = "";
    let exists = true;
    try {
      content = await readFile(file, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      exists = false;
    }
    return {
      content,
      hash: hashContent(content),
      exists,
      path: toRepoRelative(this.repoRoot, file),
    };
  }

  /**
   * Save a document only if it still matches `baseHash`, the hash of the
   * content the editor loaded. A mismatch means someone else (another tab, an
   * editor, Claude Code) changed it, and the save is rejected.
   */
  async saveDocument(
    scopeName: Scope,
    id: string,
    kind: string,
    rawInput: unknown,
  ): Promise<DocumentContent> {
    const input = parseInput(documentSaveInputSchema, rawInput, "document");
    if (scopeName === "production" && kind === "props") {
      const props = assertPropsJson(input.content);
      // Enforce the production's schema when it has a valid one. An invalid
      // schema does not block saving; preflight reports it instead.
      const { schema } = await this.readPropsSchema(id);
      const issues = schema ? validateProps(schema, props) : [];
      if (issues.length > 0) throw new SchemaValidationError("props", issues, "INVALID_INPUT");
    }
    const file = await this.#documentFile(scopeName, id, kind);
    return this.#mutex.run(file, async () => {
      const current = await this.readDocument(scopeName, id, kind);
      if (current.hash !== input.baseHash) {
        throw new MotionStudioError(
          "REVISION_CONFLICT",
          "This document changed on disk since you opened it. Reload to see the latest version.",
        );
      }
      await mkdir(path.dirname(file), { recursive: true });
      this.policy.assertAllowed(file);
      await writeFileAtomic(file, input.content);
      return {
        content: input.content,
        hash: hashContent(input.content),
        exists: true,
        path: current.path,
      };
    });
  }

  // ------------------------------------------------------- composition

  /**
   * Write the placeholder composition for a production that has no entry
   * file yet (for example one created before previews existed). Never
   * overwrites an existing entry.
   */
  async createPlaceholderComposition(id: string): Promise<{ path: string }> {
    const { dir, record } = await this.locate("production", id);
    const production = record as ProductionRecord;
    const entry = this.policy.resolveRelative(dir, production.files.entry);
    await mkdir(path.dirname(entry), { recursive: true });
    try {
      await writeFileExclusive(entry, productionCompositionTemplate(production));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new MotionStudioError("ALREADY_EXISTS", `${production.files.entry} already exists`);
      }
      throw error;
    }
    return { path: toRepoRelative(this.repoRoot, entry) };
  }

  /**
   * Optional production input props from `props.json` (for example the QR
   * destination URL). Preview and render both use these, overlaid on the
   * composition's defaultProps.
   */
  async readProductionProps(id: string): Promise<ProductionProps> {
    const { dir } = await this.locate("production", id);
    const file = this.policy.resolve(dir, PROPS_FILE);
    const relative = toRepoRelative(this.repoRoot, file);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      return { path: relative, exists: false, props: {} };
    }
    if (raw.length > MAX_PROPS_BYTES) {
      return { path: relative, exists: true, props: {}, error: "props.json is larger than 256 KB" };
    }
    try {
      const props: unknown = JSON.parse(raw);
      if (!props || typeof props !== "object" || Array.isArray(props)) {
        return {
          path: relative,
          exists: true,
          props: {},
          error: "props.json must contain a JSON object",
        };
      }
      return { path: relative, exists: true, props: props as Record<string, unknown> };
    } catch {
      return { path: relative, exists: true, props: {}, error: "props.json is not valid JSON" };
    }
  }

  /** The production's optional `props.schema.json`, parsed. Never throws for a bad schema. */
  async readPropsSchema(id: string): Promise<PropsSchemaFile> {
    const { dir } = await this.locate("production", id);
    const file = this.policy.resolve(dir, PROPS_SCHEMA_FILE);
    const relative = toRepoRelative(this.repoRoot, file);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch {
      return { path: relative, exists: false, issues: [] };
    }
    const parsed = parsePropsSchema(raw);
    return {
      path: relative,
      exists: true,
      raw,
      ...(parsed.schema ? { schema: parsed.schema } : {}),
      issues: parsed.issues,
    };
  }

  /** Props and schema together, with every problem found. Used by preflight, validation and the studio. */
  async checkProductionProps(id: string): Promise<ProductionPropsCheck> {
    const [props, schema] = await Promise.all([
      this.readProductionProps(id),
      this.readPropsSchema(id),
    ]);
    const propsIssues =
      schema.schema && !props.error ? validateProps(schema.schema, props.props) : [];
    return { props, schema, propsIssues };
  }

  // ------------------------------------------------------------------- files

  /**
   * Repository-relative paths of the files in a record folder, for the Files
   * tab. Hidden files, symlinks, render previews and nested record folders
   * (campaigns, productions) are excluded.
   */
  async listFiles(scopeName: Scope, id: string): Promise<string[]> {
    const { dir } = await this.locate(scopeName, id);
    const nested = new Set(
      scopeName === "project" ? ["campaigns"] : scopeName === "campaign" ? ["productions"] : [],
    );
    const results: string[] = [];
    const walk = async (current: string, depth: number): Promise<void> => {
      if (depth > 8) return;
      const entries = await readdir(current, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const full = path.join(current, entry.name);
        const relative = toRepoRelative(dir, full);
        if (entry.isDirectory()) {
          if (depth === 0 && nested.has(entry.name)) continue;
          if (relative === "renders/previews") continue;
          await walk(full, depth + 1);
        } else if (entry.isFile()) {
          results.push(toRepoRelative(this.repoRoot, full));
        }
      }
    };
    await walk(dir, 0);
    return results;
  }

  // ----------------------------------------------------------------- archive

  /**
   * Move a record folder, with everything beneath it, into the archive. Never
   * deletes. The operator must confirm by supplying the record's slug.
   */
  async archive(
    scopeName: Scope,
    id: string,
    rawInput: unknown,
  ): Promise<{ archivedPath: string }> {
    const input = parseInput(archiveInputSchema, rawInput, "archive request");
    const { dir, record } = await this.locate(scopeName, id);
    if (input.confirmSlug !== record.slug) {
      throw new MotionStudioError("CONFIRMATION_REQUIRED", `Type "${record.slug}" to confirm`);
    }
    return this.#mutex.run(dir, async () => {
      const stamp = formatStamp(this.#now());
      const destination = this.policy.resolve(
        this.archiveRoot,
        `${stamp}_${scopeName}_${record.slug}-${id.slice(-8)}`,
      );
      await mkdir(this.archiveRoot, { recursive: true });
      await rename(dir, destination);
      await writeJsonAtomic(path.join(destination, "archive.json"), {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        scope: scopeName,
        id,
        slug: record.slug,
        originalPath: toRepoRelative(this.repoRoot, dir),
        archivedAt: this.#timestamp(),
      });
      return { archivedPath: toRepoRelative(this.repoRoot, destination) };
    });
  }

  // ----------------------------------------------------------------- helpers

  async #updateRecord<S extends Scope>(
    scopeName: S,
    id: string,
    expectedRevision: number,
    apply: (current: z.infer<(typeof RECORD_SCHEMAS)[S]>) => object,
  ): Promise<z.infer<(typeof RECORD_SCHEMAS)[S]>> {
    const { dir } = await this.locate(scopeName, id);
    const file = this.policy.resolve(dir, RECORD_FILES[scopeName]);
    const schema = RECORD_SCHEMAS[scopeName];
    return this.#mutex.run(file, async () => {
      const current = (await readJsonRecord(file, schema, scopeName)) as z.infer<
        (typeof RECORD_SCHEMAS)[S]
      >;
      if (current.id !== id)
        throw new MotionStudioError("NOT_FOUND", `The ${scopeName} was not found`);
      if (current.revision !== expectedRevision) {
        throw new MotionStudioError(
          "REVISION_CONFLICT",
          `This ${scopeName} was changed elsewhere (revision ${current.revision}, you edited ${expectedRevision}). Reload to see the latest version.`,
        );
      }
      const next = parseInput(
        schema,
        { ...apply(current), revision: current.revision + 1, updatedAt: this.#timestamp() },
        scopeName,
      ) as z.infer<(typeof RECORD_SCHEMAS)[S]>;
      await writeJsonAtomic(file, next);
      return next;
    });
  }

  async locate(
    scopeName: Scope,
    id: string,
  ): Promise<{ dir: string; record: ProjectRecord | CampaignRecord | ProductionRecord }> {
    assertId(id);
    const catalog = await this.scan();
    for (const project of catalog.projects) {
      if (scopeName === "project" && project.record.id === id)
        return { dir: this.#abs(project.path), record: project.record };
      for (const campaign of project.campaigns) {
        if (scopeName === "campaign" && campaign.record.id === id) {
          return { dir: this.#abs(campaign.path), record: campaign.record };
        }
        for (const production of campaign.productions) {
          if (scopeName === "production" && production.record.id === id) {
            return { dir: this.#abs(production.path), record: production.record };
          }
        }
      }
    }
    throw new MotionStudioError("NOT_FOUND", `The ${scopeName} was not found`);
  }

  async #findProject(id: string): Promise<ProjectEntry> {
    assertId(id);
    const project = (await this.scan()).projects.find((entry) => entry.record.id === id);
    if (!project) throw new MotionStudioError("NOT_FOUND", "The project was not found");
    return project;
  }

  async #documentFile(scopeName: Scope, id: string, kind: string): Promise<string> {
    const relative = documentPath(scopeName, kind);
    if (!relative)
      throw new MotionStudioError("NOT_FOUND", `Unknown ${scopeName} document "${kind}"`);
    const { dir } = await this.locate(scopeName, id);
    return this.policy.resolveRelative(dir, relative);
  }

  /** Convert a repository-relative catalog path to an absolute path the policy accepts. */
  #abs(relative: string): string {
    const absolute = path.join(this.repoRoot, ...relative.split("/"));
    this.policy.assertAllowed(absolute);
    return absolute;
  }

  /**
   * Atomically claim a folder for a new record. If the slug is taken, retry
   * with a short suffix derived from the record ID; never overwrite.
   */
  async #claimFolder(
    parent: string,
    baseSlug: string,
    id: string,
    field: string,
  ): Promise<{ dir: string; slug: string }> {
    if (baseSlug === "") {
      throw new SchemaValidationError(
        "input",
        [{ path: field, message: "Must contain at least one letter or digit" }],
        "INVALID_INPUT",
      );
    }
    for (const candidate of slugCandidates(baseSlug, id)) {
      const dir = this.policy.resolve(parent, candidate);
      try {
        await createDirectoryExclusive(dir);
        return { dir, slug: candidate };
      } catch (error) {
        if (error instanceof MotionStudioError && error.code === "ALREADY_EXISTS") continue;
        throw error;
      }
    }
    throw new MotionStudioError("ALREADY_EXISTS", "Could not find a free folder name");
  }

  /**
   * Write scaffold files into a freshly claimed folder. Keys are trusted
   * template paths; the directory part goes through the policy and the file
   * name (which may be `.gitkeep`) is appended afterwards.
   */
  async #scaffold(dir: string, files: Record<string, string>): Promise<void> {
    for (const [relative, content] of Object.entries(files)) {
      const parent = path.posix.dirname(relative);
      const targetDir = parent === "." ? dir : this.policy.resolveRelative(dir, parent);
      const target = path.join(targetDir, path.posix.basename(relative));
      this.policy.assertAllowed(target);
      await mkdir(targetDir, { recursive: true });
      await writeFileExclusive(target, content);
    }
  }

  /** Claim a folder, run `build` inside it, and remove the folder if anything fails. */
  async #createIn<T>(
    parent: string,
    baseSlug: string,
    id: string,
    field: string,
    build: (dir: string, slug: string) => Promise<T>,
  ): Promise<T> {
    const { dir, slug } = await this.#claimFolder(parent, baseSlug, id, field);
    try {
      return await build(dir, slug);
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  }

  #assertProfile(profileId: string, field: string): void {
    if (!this.settings.renderProfiles.some((profile) => profile.id === profileId)) {
      throw new SchemaValidationError(
        "input",
        [{ path: field, message: `Unknown render profile "${profileId}"` }],
        "INVALID_INPUT",
      );
    }
  }

  #assertFormatLimits(format: ProductionFormat): void {
    const issues = formatLimitIssues(format, this.settings);
    if (issues.length > 0) throw new SchemaValidationError("format", issues, "INVALID_INPUT");
  }

  /** Current time as an ISO 8601 string, from the injectable clock. */
  timestamp(): string {
    return this.#timestamp();
  }

  /** Current time, from the injectable clock. */
  now(): Date {
    return this.#now();
  }

  #timestamp(): string {
    return this.#now().toISOString();
  }
}

/** props.json must be a JSON object within the size limit; anything else is refused on save. */
function assertPropsJson(content: string): Record<string, unknown> {
  const fail = (message: string) => {
    throw new SchemaValidationError("props.json", [{ path: "content", message }], "INVALID_INPUT");
  };
  if (content.length > MAX_PROPS_BYTES) fail("props.json is larger than 256 KB");
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    fail(`Not valid JSON: ${error instanceof Error ? error.message : "parse error"}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("props.json must contain a JSON object");
  }
  return value as Record<string, unknown>;
}

export function formatLimitIssues(format: ProductionFormat, settings: Settings): FieldIssue[] {
  const { limits } = settings;
  const issues: FieldIssue[] = [];
  if (format.width > limits.maxWidth)
    issues.push({ path: "format.width", message: `Maximum is ${limits.maxWidth}` });
  if (format.height > limits.maxHeight)
    issues.push({ path: "format.height", message: `Maximum is ${limits.maxHeight}` });
  if (format.fps > limits.maxFps)
    issues.push({ path: "format.fps", message: `Maximum is ${limits.maxFps}` });
  if (format.durationInFrames > limits.maxDurationInFrames) {
    issues.push({
      path: "format.durationInFrames",
      message: `Maximum is ${limits.maxDurationInFrames}`,
    });
  }
  return issues;
}

function findCampaign(
  catalog: Catalog,
  campaignId: string,
): { project: ProjectEntry; campaign: CampaignEntry } {
  assertId(campaignId);
  for (const project of catalog.projects) {
    const campaign = project.campaigns.find((entry) => entry.record.id === campaignId);
    if (campaign) return { project, campaign };
  }
  throw new MotionStudioError("NOT_FOUND", "The campaign was not found");
}

function assertId(id: string): void {
  if (!recordId.safeParse(id).success) throw new MotionStudioError("NOT_FOUND", "Unknown ID");
}

/** The base slug, then the base with 4, 6 and 8 characters of the record ID appended. */
export function slugCandidates(baseSlug: string, id: string): string[] {
  const hex = id.replaceAll("-", "");
  return [baseSlug, ...[4, 6, 8].map((length) => withSuffix(baseSlug, hex.slice(-length)))];
}

function uniqueSlug(baseSlug: string, id: string, taken: Set<string>): string {
  const free = slugCandidates(baseSlug, id).find((candidate) => !taken.has(candidate));
  if (!free) throw new MotionStudioError("ALREADY_EXISTS", "Could not find a free composition ID");
  return free;
}

function withSuffix(baseSlug: string, suffix: string): string {
  const room = SLUG_MAX_LENGTH - suffix.length - 1;
  return `${baseSlug.slice(0, room).replace(/-+$/, "")}-${suffix}`;
}

function joinSlugs(first: string, second: string): string {
  return `${first}-${second}`.slice(0, SLUG_MAX_LENGTH).replace(/-+$/, "");
}

export function formatStamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}`;
}
