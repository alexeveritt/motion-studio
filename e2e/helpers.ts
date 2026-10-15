import type { Page } from "@playwright/test";
import path from "node:path";
import { E2E_WORKSPACE } from "../playwright.config.ts";

export const workspaceDir = path.resolve(import.meta.dirname, "..", E2E_WORKSPACE);
export const productionDir = (project: string, campaign: string, production: string) =>
  path.join(workspaceDir, project, "campaigns", campaign, "productions", production);

/** Wait until every Astro island on the page has hydrated, so typed input reaches React. */
export async function hydrated(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await page.waitForFunction(() => document.querySelectorAll("astro-island[ssr]").length === 0);
}

export async function goto(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await hydrated(page);
}
