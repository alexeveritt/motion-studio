# Motion Studio

A local-only workspace for organising, previewing and rendering code-driven motion projects. One trusted operator manages projects, campaigns and productions; Claude Code writes the Remotion compositions. Plain files in this repository are the source of truth, and Git provides history.

The full build specification is in [`docs/SPEC.md`](docs/SPEC.md).

> **Status: version one complete.** All five milestones are implemented and the CookGuide acceptance production passes `pnpm acceptance` (with placeholder artwork and a placeholder QR destination until approved ones are supplied). Day-to-day operation, backup, recovery and troubleshooting are in the [operator guide](docs/operator-guide.md).

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

| Command                                     | Purpose                                                                |
| ------------------------------------------- | ---------------------------------------------------------------------- |
| `pnpm dev`                                  | Start the studio on <http://127.0.0.1:4321> using `workspace/projects` |
| `pnpm dev:fixtures`                         | Start the studio against the sample data in `fixtures/`                |
| `pnpm check`                                | Type-check the core package and run `astro check`                      |
| `pnpm test`                                 | Run unit tests (Vitest)                                                |
| `pnpm lint`                                 | Run ESLint                                                             |
| `pnpm format`                               | Format files with Prettier (`pnpm format:check` to verify only)        |
| `pnpm validate:workspace`                   | Validate every record, cross-reference, asset sidecar and asset hash   |
| `pnpm -s context-packet -- <production-id>` | Print the Claude context packet for a production                       |

`pnpm validate:workspace -- --workspace fixtures/workspace/projects` validates a different repository-relative workspace. The studio honours the same override through `MOTION_STUDIO_WORKSPACE`.

Browser tests start their own studio on port 4331 using `.motion-studio/tmp/e2e/projects`, which is wiped at the start of each run.

## Layout

```text
apps/studio/          Astro management UI and local API routes (server-side filesystem access only)
packages/core/        Zod schemas, path policy, atomic file store, workspace and asset services, registry, source check
packages/motion-runtime/  Composition contract, useAsset, useLocalFont, SafeArea, seeded helpers
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

## Assets

Each project, brand, campaign and production has an `assets/` folder. Upload through the Assets tab (drag and drop or choose files), or copy files in by hand and press **Register**.

- The file type is detected from the bytes. The browser's type and the file extension are ignored, so a PDF named `logo.png` is stored as `logo.pdf`. Allowed: PNG, JPEG, GIF, WebP, SVG, MP3, WAV, OGG, M4A, MP4, MOV, WebM, WOFF, WOFF2, TTF, OTF, PDF, TXT and Markdown.
- Names are normalised (`Phone Screen (v2).png` becomes `phone-screen-v2.png`). The original name is kept in the sidecar. A clash gets a short suffix; an identical file is refused.
- Every asset has a `<file>.asset.json` sidecar with its type, size, dimensions, SHA-256, alt text, source and licence notes. Commit both.
- SVGs containing script, event handlers, external references or entities are refused. Served SVGs are sandboxed.
- An asset referenced by any production's `src/` or `tests/` cannot be archived. Archiving moves the file and sidecar to the archive folder.
- Uploads are staged in `.motion-studio/tmp/uploads/` and limited by `maxUploadBytes` and `maxProjectBytes` in settings.

## Compositions and preview

Each production's entry file is `src/composition.tsx`. New productions get a placeholder that previews immediately; Claude Code replaces it. The entry exports:

```tsx
import type { MotionStudioComposition } from "@motion-studio/motion-runtime";

export const composition: MotionStudioComposition<Props> = {
  id: "<compositionId from production.json>",
  Component: MyAdvert,
  defaultProps: { headline: "…" },
};
```

- Width, height, FPS and duration always come from `production.json`.
- Assets are reached only through `useAsset("brand:logo.svg")` (scopes: `production`, `campaign`, `project`, `brand`), and fonts through `useLocalFont()`. Only registered assets resolve.
- Optional `props.json` in the production folder is merged over `defaultProps` (for example a QR destination URL). Its shape is declared in `props.schema.json`; see [Props](#props).
- `packages/motion-runtime` also exports `SafeArea`, `seededRange` and `seededInt`.

The studio generates a registry of compositions at `.motion-studio/cache/registry/<workspace>.ts` (gitignored) from the validated production records, on startup and whenever a production or entry file appears. Only productions listed there can be loaded; nothing is imported from a URL parameter.

The **Preview** tab plays the composition with play/pause, exact frame entry, a scrubber, single-frame steps (buttons or ← →, Shift for one second, Home/End), poster-frame jump, loop, volume and Fit/50%/100% zoom. The paused frame is kept in the URL, so reloading after a source edit returns to it. Runtime errors appear in an overlay; load errors show TypeScript diagnostics with file and line, and **Check source** runs the same check on demand.

Remotion is used under its own licence: some companies need a Remotion company licence (<https://remotion.dev/license>). The Player shows a console notice until `acknowledgeRemotionLicense` is set, which is left to the repository owner.

## Rendering

Render from a production's **Render** tab or with `pnpm render`. Both use the same controller:

1. **Preflight** checks the records, type-checks the composition, checks format limits, verifies every asset is present and matches its SHA-256 (and that audio and video can be probed), checks the poster frame, the profile, pinned Remotion versions, writable output folders and Git state, and computes the **input fingerprint** from the production format, profile, props, source files, shared runtime, asset hashes and lockfile. Failures block the render; warnings (such as uncommitted changes) are recorded.
2. A worker process (`scripts/render-worker.ts`, spawned with an argument array, no shell and a minimal environment) bundles only this production, renders **sample frames** (start, quarters, end and poster) to catch runtime errors early, then renders the MP4 and the poster.
3. The controller re-checks the fingerprint, probes the video with ffprobe (H.264, `yuv420p`, size, FPS, exact frame count, duration) and the poster, hashes both, moves them into `renders/final/` without overwriting anything, and writes the manifest to `renders/manifests/` last.

Outputs follow `YYYYMMDD-HHmmss_<production>_<profile>_<fingerprint-8>.mp4`, `…-poster.png` and `….render.json`. Commit the manifests and the approved final (see below). Failed or cancelled renders never produce a manifest; their partial files are deleted and the log is kept in `.motion-studio/jobs/<render-id>/log.txt`.

Only one render runs at a time on the machine (a lock in `.motion-studio/jobs/`), whether started from the studio or the CLI; a second request gets a "busy" error. Cancel sends SIGTERM, then SIGKILL after five seconds. Renders are limited by `renderTimeoutSeconds`. If Motion Studio stops mid-render, the job is marked interrupted on the next start and its partial files removed; completed renders are never deleted.

The first render downloads Remotion's pinned headless Chrome (cached afterwards). Rendering runs with `TZ=UTC`.

### Approving a render

Every render lands in `renders/final/`, so mark the one to publish: press **Approve as final** on a video in the Render tab's **Outputs**, with an optional note (who approved it, for which channel). The approval is written to `renders/approved.json`, with the render ID, profile, input fingerprint and the SHA-256 of its manifest, video and poster. Render manifests are never changed.

- One render per production is approved; approving another replaces it, and **Withdraw approval** removes it. Renders themselves are kept either way.
- The Render tab checks the approval each time it loads. It shows **approved** when the files are intact and the inputs unchanged, **approved, inputs changed since** when source, props, assets, settings or dependencies have changed since that render (render again and approve the new one if the changes should ship), and **approval broken** when `approved.json` is invalid or a file it names is missing or changed.
- `pnpm validate:workspace` reports broken approvals as errors and outdated ones as warnings.
- Changes are guarded by the file's hash, like documents, so a stale tab cannot overwrite an approval made elsewhere.
- Commit `renders/approved.json` together with the approved video, poster and manifest.

### Archiving renders

Renders you do not want to keep can be moved out of the production folder. **Move to archive** on any output except the approved one moves its manifest, video and poster to `workspace/archive/<timestamp>_renders_<production>-<id>/`, keeping their paths below the production folder and recording them in `archive.json`. Once a render is approved, **Archive the other N outputs** does the same for everything else at once, so `renders/final/` holds only what ships. Nothing is deleted, and the approved render cannot be archived until its approval is withdrawn. To restore, move the files back under the production folder.

### Golden frames

List frames in a production's `tests/golden.json` (`{ "frames": [0, 59, 60, 359] }`, optional `profileId` and `tolerance`) and commit baselines in `tests/golden/`. The **Golden frames** tab renders those frames, compares them pixel by pixel with the baselines, and shows baseline, new frame and a red difference image side by side; intended changes are accepted as new baselines per frame after confirmation. `pnpm golden -- <production-id> [--update]` does the same from the command line. See the [operator guide](docs/operator-guide.md#golden-frames) for tolerance details.

## Props

Production-specific values (destination URLs, dates, copy variants) live in `props.json`, never in source. Each production declares their shape in `props.schema.json`, a small, strict subset of JSON Schema:

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["qrUrl"],
  "properties": {
    "qrUrl": {
      "type": "string",
      "title": "QR destination",
      "format": "uri",
      "pattern": "^https://"
    },
    "variant": { "type": "string", "enum": ["warm", "fresh"], "default": "warm" },
    "loops": { "type": "integer", "minimum": 1, "maximum": 3 },
    "showSafeArea": { "type": "boolean", "default": false }
  }
}
```

Supported: `string`, `number`, `integer` and `boolean` fields with `title`, `description`, `default`, `enum`, `format` (`uri`, `date`, `color`), `pattern`, `minLength`, `maxLength`, `minimum` and `maximum`, plus top-level `required`. Anything else makes the schema invalid, and props the schema does not define are rejected, so a typo cannot quietly switch checking off.

- The **Props** tab is generated from the schema: one field per prop, validated as you save. The raw JSON editor stays available under _Advanced_.
- Saving props that break a valid schema is refused, from the form or the API.
- **Preflight** fails the render when the schema is invalid or the props do not match it, and `pnpm validate:workspace` reports the same problems.
- New productions are scaffolded with a schema matching the placeholder. The context packet includes the schema and tells Claude Code to keep it in step with the composition.

## Handing work to Claude Code

The Prompt tab on a production holds the saved `prompt.md` and a **Claude handoff** panel:

- **Copy context packet** copies a Markdown bundle of the prompt, edit boundary, composition contract, production record, render profile, project and campaign summaries, project context, brand guidance, brief, asset inventory with hashes, source file inventory and commands. It is generated from the files every time and never stored. The same packet prints with `pnpm -s context-packet -- <production-id>`.
- **Regenerate prompt from template** writes a candidate to `.motion-studio/tmp/prompt-candidates/` and shows a diff. Your `prompt.md` changes only if you press **Replace saved prompt**.

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
