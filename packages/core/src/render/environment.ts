import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

export type ToolVersions = Record<
  "remotion" | "@remotion/renderer" | "@remotion/bundler" | "@remotion/player",
  string | undefined
>;

/** Installed versions of the Remotion packages, resolved from the repository root. */
export async function remotionVersions(repoRoot: string): Promise<ToolVersions> {
  const version = async (name: string, from = repoRoot) => {
    try {
      const resolve = createRequire(path.join(from, "package.json")).resolve;
      let dir = path.dirname(resolve(name));
      while (!dir.endsWith(path.join("node_modules", ...name.split("/")))) {
        const parent = path.dirname(dir);
        if (parent === dir) return undefined;
        dir = parent;
      }
      return (
        JSON.parse(await readFile(path.join(dir, "package.json"), "utf8")) as { version: string }
      ).version;
    } catch {
      return undefined;
    }
  };
  return {
    remotion: await version("remotion"),
    "@remotion/renderer": await version("@remotion/renderer"),
    "@remotion/bundler": await version("@remotion/bundler"),
    "@remotion/player": await version("@remotion/player", path.join(repoRoot, "apps", "studio")),
  };
}

export async function pinnedVersions(
  repoRoot: string,
): Promise<{ pnpm?: string; node?: string; remotion?: string }> {
  const pkg = await readFile(path.join(repoRoot, "package.json"), "utf8").then(
    (text) =>
      JSON.parse(text) as { packageManager?: string; dependencies?: Record<string, string> },
    () => ({}) as { packageManager?: string; dependencies?: Record<string, string> },
  );
  const node = await readFile(path.join(repoRoot, ".node-version"), "utf8").then(
    (text) => text.trim(),
    () => undefined,
  );
  return {
    ...(pkg.packageManager?.startsWith("pnpm@") ? { pnpm: pkg.packageManager.slice(5) } : {}),
    ...(node ? { node } : {}),
    ...(pkg.dependencies?.remotion ? { remotion: pkg.dependencies.remotion } : {}),
  };
}

/** The manifest's environment block. */
export async function renderEnvironment(repoRoot: string) {
  const pinned = await pinnedVersions(repoRoot);
  const versions = await remotionVersions(repoRoot);
  return {
    node: process.version,
    pnpm: pinned.pnpm ?? "unknown",
    remotion: versions.remotion ?? "unknown",
    platform: process.platform,
    architecture: process.arch,
  };
}
