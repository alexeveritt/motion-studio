import {
  toRepoRelative,
  type CampaignEntry,
  type Catalog,
  type ProductionEntry,
  type ProjectEntry,
} from "@motion-studio/core";
import { getAssets, getWorkspace } from "./studio.ts";

/** Everything a page needs: the service, a fresh catalog and display helpers. */
export async function loadPageContext() {
  const workspace = await getWorkspace();
  const catalog = await workspace.scan();
  return {
    workspace,
    assets: await getAssets(),
    catalog,
    maxUploadBytes: workspace.settings.limits.maxUploadBytes,
    profiles: workspace.settings.renderProfiles.map((profile) => ({
      value: profile.id,
      label: profile.name,
    })),
    archiveFolder: toRepoRelative(workspace.repoRoot, workspace.archiveRoot),
  };
}

export function findProject(catalog: Catalog, slug: string | undefined): ProjectEntry | undefined {
  return catalog.projects.find((entry) => entry.record.slug === slug);
}

export function findCampaign(
  project: ProjectEntry | undefined,
  slug: string | undefined,
): CampaignEntry | undefined {
  return project?.campaigns.find((entry) => entry.record.slug === slug);
}

export function findProduction(
  campaign: CampaignEntry | undefined,
  slug: string | undefined,
): ProductionEntry | undefined {
  return campaign?.productions.find((entry) => entry.record.slug === slug);
}

export const projectUrl = (project: string) => `/projects/${project}`;
export const campaignUrl = (project: string, campaign: string) =>
  `${projectUrl(project)}/campaigns/${campaign}`;
export const productionUrl = (project: string, campaign: string, production: string) =>
  `${campaignUrl(project, campaign)}/productions/${production}`;
