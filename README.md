# Motion Studio

A local-only workspace for organising, previewing and rendering code-driven motion projects. One trusted operator manages projects, campaigns and productions; Claude Code writes the Remotion compositions. Plain files in this repository are the source of truth, and Git provides history.

The full build specification is in [`docs/SPEC.md`](docs/SPEC.md).

> **Status: Milestone 1 (filesystem domain and CRUD).** Projects, campaigns and productions can be created, edited and archived from the studio, and their Markdown documents edited. Assets, preview and rendering arrive in later milestones.

## Requirements

| Tool    | Version   | Notes                                                  |
| ------- | --------- | ------------------------------------------------------ |
| Node.js | `24.11.x` | Pinned in `.node-version`; runs `.ts` scripts natively |
| pnpm    | `11.25.0` | Pinned in `package.json` `packageManager`              |

With Corepack, `corepack enable` selects the pinned pnpm automatically.

## Setup

```sh
pnpm install
pnpm exec playwright install chromium   # once, for browser tests only
```

## Commands

| Command                   | Purpose                                                                |
| ------------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`                | Start the studio on <http://127.0.0.1:4321> using `workspace/projects` |
| `pnpm dev:fixtures`       | Start the studio against the sample data in `fixtures/`                |
| `pnpm check`              | Type-check the core package and run `astro check`                      |
| `pnpm test`               | Run unit tests (Vitest)                                                |
| `pnpm lint`               | Run ESLint                                                             |
| `pnpm format`             | Format files with Prettier (`pnpm format:check` to verify only)        |
| `pnpm validate:workspace` | Validate every record and cross-reference; exits 1 on errors           |

`pnpm validate:workspace -- --workspace fixtures/workspace/projects` validates a different repository-relative workspace. The studio honours the same override through `MOTION_STUDIO_WORKSPACE`.

Not yet implemented: `pnpm render` and `pnpm poster` (Milestone 4).

Browser tests start their own studio on port 4331 using `.motion-studio/tmp/e2e/projects`, which is wiped at the start of each run.

## Layout

```text
apps/studio/          Astro management UI and local API routes (server-side filesystem access only)
packages/core/        Zod schemas, path policy, atomic file store, workspace service, catalog scanner
workspace/projects/   Your creative work: projects, campaigns, productions
workspace/archive/    Archived records (created on first archive)
fixtures/workspace/   Sample records used by tests and `pnpm dev:fixtures`
e2e/                  Playwright browser tests
scripts/              Command-line tools (workspace validation; later render and poster)
.motion-studio/       settings.json (committed); cache/, jobs/, tmp/ (ignored)
docs/                 Specification and operator guidance
```

Each project is a folder under `workspace/projects/<slug>/` containing `project.json`, `context.md` and a `campaigns/` tree. Each production folder holds `production.json`, `brief.md`, `prompt.md`, `notes.md`, `assets/`, and later `src/` and `renders/`. See section 6 of the specification.

## Working in the studio

- **Create** a project from the dashboard, then campaigns and productions from their parent pages. Folder names come from the display name and are fixed once created; a clash gets a short suffix instead of overwriting anything.
- **Edit** metadata in the Details form and Markdown in the Context, Brand, Brief, Prompt and Notes tabs. Saving is explicit (button or Cmd/Ctrl+S).
- **Conflicts**: every save carries the revision (records) or content hash (documents) it started from. If the file changed in the meantime, for example because Claude Code edited it, the save is refused and nothing is overwritten. Copy your text, load the latest version and reapply.
- **Archive** moves a folder, with everything beneath it, to `workspace/archive/<timestamp>_<scope>_<slug>-<id>/` after you type its slug. Nothing is deleted. To restore it, move the folder back and remove `archive.json`.
- Editing files directly is fine. The studio rescans the disk on every page load, and `pnpm validate:workspace` reports anything malformed.

## Settings

`.motion-studio/settings.json` holds the workspace root, the loopback port, size and format limits, and the render profiles (`draft`, `standard`, `high-quality`). Restart the studio after editing it.

## Local-only and trust model

- The server binds to `127.0.0.1` only; the settings schema rejects any other host.
- Requests with a non-loopback `Host` header are refused, and every mutation must carry a same-origin `Origin` header and a JSON body within the size limit.
- Every filesystem path is built by one path policy in `packages/core/src/paths.ts`: no traversal, hidden or control characters, and no symlinks inside the workspace.
- Markdown previews render with raw HTML disabled and unsafe link schemes blocked.
- No CORS headers, no remote fetches, no telemetry (`ASTRO_TELEMETRY_DISABLED=1` is set by the scripts).
- Remotion compositions are executable local code. Motion Studio is not a sandbox: only preview or render source written or reviewed by you or your trusted coding agent.

Motion Studio never commits, pushes or changes branches for you.
