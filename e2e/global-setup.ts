import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { E2E_WORKSPACE } from "../playwright.config.ts";

/** Start every run from an empty workspace. */
export default async function globalSetup() {
  const root = path.resolve(import.meta.dirname, "..", path.dirname(E2E_WORKSPACE));
  await rm(root, { recursive: true, force: true });
  await mkdir(path.join(root, "projects"), { recursive: true });
}
