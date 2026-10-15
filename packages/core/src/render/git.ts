import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type GitState = { commit?: string; dirty: boolean };

/** Current commit and dirty state, read-only. Undefined when Git is unavailable or this is not a repository. */
export async function gitState(repoRoot: string): Promise<GitState | undefined> {
  // HOME is needed because system and user git config may include `~/` paths.
  const env = {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GIT_OPTIONAL_LOCKS: "0",
  };
  const options = { cwd: repoRoot, timeout: 10_000, env };
  try {
    const status = await run("git", ["status", "--porcelain", "--untracked-files=normal"], options);
    const commit = await run("git", ["rev-parse", "HEAD"], options).then(
      ({ stdout }) => stdout.trim(),
      () => undefined,
    );
    return { ...(commit ? { commit } : {}), dirty: status.stdout.trim().length > 0 };
  } catch {
    return undefined;
  }
}
