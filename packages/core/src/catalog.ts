import type { Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { MotionStudioError, type ErrorCode } from "./errors.ts";
import { toRepoRelative } from "./repo.ts";
import { campaignRecordSchema, type CampaignRecord } from "./schemas/campaign.ts";
import { parseRecord, type RecordKind } from "./schemas/parse.ts";
import { productionRecordSchema, type ProductionRecord } from "./schemas/production.ts";
import { projectRecordSchema, type ProjectRecord } from "./schemas/project.ts";
import type { Settings } from "./schemas/settings.ts";
import { isValidSlug } from "./slug.ts";

export type CatalogIssue = {
  severity: "error" | "warning";
  code: ErrorCode;
  /** Repository-relative path of the file or folder with the problem. */
  path: string;
  message: string;
};

export type ProductionEntry = { record: ProductionRecord; path: string };
export type CampaignEntry = {
  record: CampaignRecord;
  path: string;
  productions: ProductionEntry[];
};
export type ProjectEntry = { record: ProjectRecord; path: string; campaigns: CampaignEntry[] };

export type Catalog = {
  workspacePath: string;
  projects: ProjectEntry[];
  issues: CatalogIssue[];
};

type ScanOptions = { repoRoot: string; workspaceRoot: string; settings: Settings };

/**
 * Build the catalog by scanning the workspace. The catalog is derived state:
 * the JSON records on disk are authoritative. Invalid entries are reported as
 * issues and skipped so one bad record never hides the rest of the workspace.
 */
export async function scanCatalog({
  repoRoot,
  workspaceRoot,
  settings,
}: ScanOptions): Promise<Catalog> {
  const issues: CatalogIssue[] = [];
  const rel = (absolutePath: string) => toRepoRelative(repoRoot, absolutePath);
  const report = (
    severity: CatalogIssue["severity"],
    code: ErrorCode,
    at: string,
    message: string,
  ) => issues.push({ severity, code, path: rel(at), message });

  const profileIds = new Set(settings.renderProfiles.map((profile) => profile.id));
  const seenIds = new Map<string, string>();
  const seenCompositions = new Map<string, string>();

  const claimId = (id: string, at: string) => {
    const previous = seenIds.get(id);
    if (previous) {
      report("error", "DUPLICATE_ID", at, `ID ${id} is already used by ${previous}`);
      return false;
    }
    seenIds.set(id, rel(at));
    return true;
  };

  const checkProfile = (profileId: string, at: string) => {
    if (!profileIds.has(profileId)) {
      report(
        "warning",
        "UNKNOWN_RENDER_PROFILE",
        at,
        `Render profile "${profileId}" is not defined in settings`,
      );
    }
  };

  async function readRecord<T extends z.ZodType>(
    dir: string,
    fileName: string,
    schema: T,
    kind: RecordKind,
  ): Promise<z.infer<T> | undefined> {
    const file = path.join(dir, fileName);
    try {
      const stats = await lstat(file);
      if (!stats.isFile()) {
        report(
          "error",
          "UNSAFE_ENTRY",
          file,
          `${fileName} must be a regular file, not a link or folder`,
        );
        return undefined;
      }
    } catch {
      report("error", "RECORD_MISSING", dir, `Folder has no ${fileName}`);
      return undefined;
    }
    try {
      return parseRecord(schema, JSON.parse(await readFile(file, "utf8")), kind);
    } catch (error) {
      if (error instanceof MotionStudioError) {
        report("error", error.code, file, error.message);
      } else if (error instanceof SyntaxError) {
        report("error", "JSON_INVALID", file, `${fileName} is not valid JSON`);
      } else {
        report("error", "READ_FAILED", file, `${fileName} could not be read`);
      }
      return undefined;
    }
  }

  const projects: ProjectEntry[] = [];
  for (const projectDir of await childDirectories(workspaceRoot, report)) {
    const project = await readRecord(projectDir, "project.json", projectRecordSchema, "project");
    if (!project || !claimId(project.id, projectDir)) continue;
    checkSlug(project.slug, projectDir, report);
    checkProfile(project.defaultRenderProfileId, projectDir);

    const campaigns: CampaignEntry[] = [];
    for (const campaignDir of await childDirectories(path.join(projectDir, "campaigns"), report)) {
      const campaign = await readRecord(
        campaignDir,
        "campaign.json",
        campaignRecordSchema,
        "campaign",
      );
      if (!campaign || !claimId(campaign.id, campaignDir)) continue;
      checkSlug(campaign.slug, campaignDir, report);
      if (campaign.projectId !== project.id) {
        report(
          "error",
          "REFERENCE_MISMATCH",
          campaignDir,
          "projectId does not match the parent project",
        );
      }

      const productions: ProductionEntry[] = [];
      for (const productionDir of await childDirectories(
        path.join(campaignDir, "productions"),
        report,
      )) {
        const production = await readRecord(
          productionDir,
          "production.json",
          productionRecordSchema,
          "production",
        );
        if (!production || !claimId(production.id, productionDir)) continue;
        checkSlug(production.slug, productionDir, report);
        checkProfile(production.defaultRenderProfileId, productionDir);
        if (production.projectId !== project.id || production.campaignId !== campaign.id) {
          report(
            "error",
            "REFERENCE_MISMATCH",
            productionDir,
            "projectId or campaignId does not match the parent folders",
          );
        }
        const otherComposition = seenCompositions.get(production.compositionId);
        if (otherComposition) {
          report(
            "error",
            "DUPLICATE_ID",
            productionDir,
            `compositionId "${production.compositionId}" is already used by ${otherComposition}`,
          );
        } else {
          seenCompositions.set(production.compositionId, rel(productionDir));
        }
        productions.push({ record: production, path: rel(productionDir) });
      }
      campaigns.push({ record: campaign, path: rel(campaignDir), productions });
    }
    projects.push({ record: project, path: rel(projectDir), campaigns });
  }

  return { workspacePath: rel(workspaceRoot), projects, issues };
}

type Report = (
  severity: CatalogIssue["severity"],
  code: ErrorCode,
  at: string,
  message: string,
) => void;

/**
 * Sorted child directories of `dir`. Hidden entries are ignored; symlinks and
 * folders whose names are not valid slugs are reported and skipped. A missing
 * directory is treated as empty.
 */
async function childDirectories(dir: string, report: Report): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const result: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      report(
        "warning",
        "UNSAFE_ENTRY",
        fullPath,
        "Symbolic links are ignored inside the workspace",
      );
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (!isValidSlug(entry.name)) {
      report(
        "warning",
        "SLUG_MISMATCH",
        fullPath,
        "Folder name is not a valid slug and was skipped",
      );
      continue;
    }
    result.push(fullPath);
  }
  return result;
}

function checkSlug(slug: string, dir: string, report: Report): void {
  if (path.basename(dir) !== slug) {
    report(
      "error",
      "SLUG_MISMATCH",
      dir,
      `Record slug "${slug}" does not match folder name "${path.basename(dir)}"`,
    );
  }
}
