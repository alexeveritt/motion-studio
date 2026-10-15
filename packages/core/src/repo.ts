import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MotionStudioError } from "./errors.ts";
import { parseRecord } from "./schemas/parse.ts";
import { repoRelativePath, settingsSchema, type Settings } from "./schemas/settings.ts";

export const SETTINGS_RELATIVE_PATH = ".motion-studio/settings.json";

/** Walk upwards from `startDir` to the directory containing `.motion-studio/settings.json`. */
export function findRepoRoot(startDir: string): string {
  let current = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(current, SETTINGS_RELATIVE_PATH))) return realpathSync(current);
    const parent = path.dirname(current);
    if (parent === current) {
      throw new MotionStudioError(
        "SETTINGS_NOT_FOUND",
        `Could not find ${SETTINGS_RELATIVE_PATH}. Run Motion Studio from inside the repository.`,
      );
    }
    current = parent;
  }
}

export async function loadSettings(repoRoot: string): Promise<Settings> {
  const raw = await readFile(path.join(repoRoot, SETTINGS_RELATIVE_PATH), "utf8");
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new MotionStudioError("JSON_INVALID", `${SETTINGS_RELATIVE_PATH} is not valid JSON`, {
      cause: error,
    });
  }
  return parseRecord(settingsSchema, data, "settings");
}

/**
 * Resolve the workspace root. `override` (for example from
 * MOTION_STUDIO_WORKSPACE) must also be repository-relative and must resolve
 * inside the repository, even through symlinks.
 */
export function resolveWorkspaceRoot(
  repoRoot: string,
  settings: Settings,
  override?: string,
): string {
  const relative = override ?? settings.workspaceRoot;
  const parsed = repoRelativePath.safeParse(relative);
  if (!parsed.success) {
    throw new MotionStudioError(
      "PATH_OUTSIDE_ROOT",
      `Workspace root "${relative}" must be a repository-relative path`,
    );
  }
  const resolved = path.resolve(repoRoot, parsed.data);
  const canonical = existsSync(resolved) ? realpathSync(resolved) : resolved;
  if (!isInside(repoRoot, canonical)) {
    throw new MotionStudioError(
      "PATH_OUTSIDE_ROOT",
      `Workspace root "${relative}" resolves outside the repository`,
    );
  }
  return canonical;
}

/** True when `candidate` equals `root` or is nested beneath it. Both must be absolute. */
export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Repository-relative POSIX path for display and manifests. Never expose absolute paths. */
export function toRepoRelative(repoRoot: string, absolutePath: string): string {
  return path.relative(repoRoot, absolutePath).split(path.sep).join("/");
}
