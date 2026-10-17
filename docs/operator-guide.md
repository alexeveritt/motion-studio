# Motion Studio operator guide

For the person who runs Motion Studio day to day. The [README](../README.md) is the quick reference; the [specification](SPEC.md) explains why things work the way they do.

## 1. Install

Supported machine: macOS or Linux, Node.js `24.11.x` (`.node-version`), pnpm `11.25.0` (`packageManager` in `package.json`). Development and acceptance ran on macOS 26 on Apple silicon.

```sh
git clone <repository> motion-studio && cd motion-studio
corepack enable                          # selects the pinned pnpm
pnpm install                             # one command installs everything
pnpm exec playwright install chromium    # only needed for pnpm test:e2e
pnpm check && pnpm test                  # optional: confirm the install
```

The first render downloads Remotion's pinned headless Chrome once. Rendering needs no other system tools; ffmpeg and ffprobe ship with Remotion.

## 2. Start and stop

```sh
pnpm dev            # http://127.0.0.1:4321, the workspace in workspace/projects
pnpm dev:fixtures   # the sample data in fixtures/, for exploring safely
```

Stop with Ctrl+C. The server listens only on `127.0.0.1` and refuses requests addressed to any other host name. The port is `server.port` in `.motion-studio/settings.json`; restart after editing settings.

If Astro detects an AI coding agent it starts the dev server in the background; stop it with `pnpm --filter @motion-studio/studio exec astro dev stop`.

## 3. Everyday workflow

1. **Project** (Dashboard → New project): a brand or product. Fill in the **Context** tab: what may and may not be claimed matters most. Put logos and fonts in **Assets → Brand assets**.
2. **Campaign** (project page → New campaign): objective, audience, key messages, channels.
3. **Production** (campaign page → New production): title, size, FPS, duration in frames and poster frame. New productions get a placeholder composition and preview straight away.
4. **Brief**: fill in every section. The header shows how many are complete.
5. **Assets**: upload production-specific files, or copy them into the folder and press **Register**. Add alt text, source and licence notes.
6. **Props**: production-specific values such as a QR destination URL go on the **Props** tab, never in source code. The form is generated from the production's `props.schema.json` and checks each value as you save; preflight refuses to render with invalid props.
7. **Hand off to Claude Code**: on the **Prompt** tab, edit the request and press **Copy context packet**. Paste both into Claude Code. Claude works only inside the production folder and never commits.
8. **Preview**: scrub, step frame by frame (← →), jump to the poster frame. Errors show in the player; **Check source** lists type errors with file and line.
9. **Render**: **Run preflight**, then **Render MP4 and poster** with the `standard` profile (`draft` for quick checks, `high-quality` for masters).
10. **Approve**: under **Outputs**, press **Approve as final** on the video to publish and add a note (who approved it, for which channel). This writes `renders/approved.json`. If the badge later says _approved, inputs changed since_, the source, props or assets changed after that render: render again and approve the new one if the changes should ship. Then press **Archive the other N outputs** to move the drafts and earlier renders to `workspace/archive/`, leaving only the approved render in `renders/final/`.
11. **Commit**: review with `git status` and `git diff`, then commit the records, source, assets, manifests, `renders/approved.json` and the approved video and poster yourself. Motion Studio never commits, pushes or changes branches.

### Render profiles

| Profile        | CRF | Scale | Use                              |
| -------------- | --: | ----: | -------------------------------- |
| `draft`        |  28 |   0.5 | Quick review; half size          |
| `standard`     |  20 |     1 | Approval renders                 |
| `high-quality` |  16 |     1 | Final masters; slower and larger |

### Golden frames

For productions that must not change by accident, list frames to check in `tests/golden.json`:

```json
{
  "frames": [0, 59, 60, 179, 180, 269, 270, 359],
  "profileId": "standard",
  "tolerance": { "channelThreshold": 16, "maxDifferentRatio": 0.002 }
}
```

A pixel differs when any colour channel moves by more than `channelThreshold` (0–255), and a frame passes while at most `maxDifferentRatio` of its pixels differ (0.002 = 0.2 %).

In the studio, open the production's **Golden frames** tab and press **Run golden check**. It renders the frames (like any render, one at a time and after preflight), compares them, and shows each frame's baseline, new frame and difference image (changed pixels in red) side by side, with the share of pixels that differ. Frames that match are hidden until you untick **Only show frames that need attention**. When a change is intended, press **Accept new frame as baseline** on that frame (or **Accept all** for every changed frame); frames without a baseline get **Save as baseline**. Each asks for confirmation and writes `tests/golden/frame-<n>.png`; review the change with `git diff` before committing.

From the command line, `pnpm golden -- <production-id>` re-renders and compares (exit code 1 on any difference), and `pnpm golden -- <production-id> --update` replaces every baseline. Reports and diff images are kept under `.motion-studio/tmp/golden/<render-id>/` (ignored by Git), and the studio shows the latest one from either route.

### Acceptance

`pnpm acceptance` runs the CookGuide acceptance test from spec section 17: two real renders, output probing, QR decoding from the poster and a paused frame, hash and manifest checks, fingerprint behaviour, golden frames and the failure cases. It takes about two minutes and restores anything it changes, except that its two renders stay in the production's Outputs; archive them from the Render tab if you do not want to keep them.

## 4. Where things live

| Path                                      | What                                                                                  | Commit?       |
| ----------------------------------------- | ------------------------------------------------------------------------------------- | ------------- |
| `workspace/projects/<project>/`           | Projects, campaigns, productions, briefs, prompts, assets and sidecars, source, tests | Yes           |
| `…/productions/<p>/renders/manifests/`    | Render manifests: inputs, environment, Git state, output hashes                       | Yes           |
| `…/productions/<p>/renders/final/`        | Rendered MP4s and posters                                                             | Approved ones |
| `…/productions/<p>/renders/approved.json` | Which render is the approved final, with hashes of its files                          | Yes           |
| `workspace/archive/`                      | Archived records and assets (never deleted)                                           | Yes           |
| `.motion-studio/settings.json`            | Port, limits, render profiles                                                         | Yes           |
| `.motion-studio/cache/`                   | Generated composition registry; safe to delete                                        | No (ignored)  |
| `.motion-studio/jobs/`                    | Render job state and logs                                                             | No (ignored)  |
| `.motion-studio/tmp/`                     | Upload staging, prompt candidates, golden-frame diffs, test workspaces                | No (ignored)  |

Every record is plain JSON or Markdown; you can read and edit them directly. Run `pnpm validate:workspace` after hand edits.

## 5. Backup

The repository is the backup unit.

- **Commit often** and push to a private remote. Everything important (records, documents, assets, source, manifests, approved renders) is a committed file.
- Large source assets go into Git as normal files. If the repository grows uncomfortably (hundreds of megabytes of video), move them to Git LFS; nothing in Motion Studio needs to change.
- The ignored folders under `.motion-studio/` never need backing up: they are rebuilt or are diagnostics.
- To check a backup, clone it fresh, `pnpm install`, and run `pnpm validate:workspace`; asset hashes are verified against their sidecars.

## 6. Recovery

| Situation                                            | What to do                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Motion Studio stopped during a render                | Nothing. On the next start the job is marked _interrupted_, its partial files are removed and the lock released. Completed renders are never touched. Render again.                                                                                                                      |
| "Another render is running" but nothing is           | The lock holder's process is gone if this persists after a restart. Motion Studio reclaims locks from dead processes automatically; as a last resort delete `.motion-studio/jobs/active.lock` while no render runs.                                                                      |
| Archived something by mistake                        | Move the folder from `workspace/archive/<timestamp>_<scope>_<slug>-<id>/` back to its `originalPath` (in `archive.json`) and delete `archive.json`. Assets: move the file and its `.asset.json` back. Renders: move `renders/…` from the archive folder back into the production folder. |
| "This was changed elsewhere" on save                 | Someone (often Claude Code) changed the file on disk. Copy your text, load the latest version, reapply your change. Nothing was overwritten.                                                                                                                                             |
| A record shows a validation issue                    | Open the file named in the issue, fix it (or restore it from Git), run `pnpm validate:workspace`. Records with errors are hidden until fixed.                                                                                                                                            |
| Render tab says _approval broken_                    | `renders/approved.json` names a manifest, video or poster that is missing or has changed. Restore the files from Git, or press **Withdraw approval** and approve a current render.                                                                                                       |
| Asset shows _modified_ or _missing_                  | The file changed after upload or was removed. Restore it from Git, or upload the new version as a new asset and update references.                                                                                                                                                       |
| Preview stuck on "Updating the composition registry" | Reload the page. If it persists, stop the studio, delete `.motion-studio/cache/`, start again.                                                                                                                                                                                           |
| Disk filling up after many renders                   | Earlier versions left about 180 MB of bundler cache per render in `node_modules/.cache/webpack`; it is never reused. Delete that folder. Also archive unwanted renders from the Render tab.                                                                                              |
| Anything else odd after an upgrade                   | Delete `.motion-studio/cache/` and restart. It is always safe.                                                                                                                                                                                                                           |

## 7. Troubleshooting

| Symptom                                                                  | Cause and fix                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install` fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`       | pnpm refuses packages published in the last day. Wait, or pin the previous version. Do not add exclusions casually.                                                                                                                       |
| Port 4321 already in use                                                 | Another studio is running (`astro dev status`) or change `server.port` in settings.                                                                                                                                                       |
| "Workspace unavailable" on the dashboard                                 | `.motion-studio/settings.json` is invalid or the workspace path escapes the repository; the message names the problem.                                                                                                                    |
| Preflight fails "Composition source type-checks"                         | Open the Preview tab and press **Check source** for file:line errors, or run `pnpm check`.                                                                                                                                                |
| Preflight fails "Assets present, unchanged and readable"                 | See _Asset shows modified or missing_ above. Files without sidecars are warnings; register them.                                                                                                                                          |
| Preflight fails "Props match the production's schema"                    | A prop is missing or invalid (the message names it), or `props.schema.json` itself is broken. Fix the value on the **Props** tab; ask Claude Code to fix a broken schema.                                                                 |
| Props tab says "No props schema"                                         | Older productions have none. Ask Claude Code to add `props.schema.json` matching the composition's props.                                                                                                                                 |
| Render fails "The composition threw at frame N"                          | A runtime error in the composition. Preview that frame to see the overlay and stack. Missing props (for example `props.qrUrl is missing`) show up here.                                                                                   |
| Render fails "Output check failed"                                       | The encoded video did not match the configuration (size, FPS, frame count). Check the profile scale gives even dimensions and the composition does not override its size.                                                                 |
| Render fails "Source, assets, props or settings changed while rendering" | Something edited the inputs mid-render. Render again once edits are finished.                                                                                                                                                             |
| First render fails while downloading the browser                         | Rendering needs network access once to fetch Remotion's headless Chrome. Retry when online; afterwards renders work offline.                                                                                                              |
| Fonts look wrong in preview or render                                    | Load them with `useLocalFont()` from a registered font asset; system fonts differ between machines.                                                                                                                                       |
| QR code will not scan                                                    | Keep the quiet zone (the `QrCode` component enforces four modules), black on white, nothing over it, static, and large enough (at least about 15 px per module at 1080 × 1920). `pnpm acceptance` decodes it automatically for CookGuide. |
| Console note about a Remotion licence                                    | Remotion requires a company licence for some organisations (<https://remotion.dev/license>). Once settled, the owner can set `acknowledgeRemotionLicense` on the Player in `apps/studio/src/components/ProductionPreview.tsx`.            |
| Render logs                                                              | `.motion-studio/jobs/<render-id>/log.txt`; the Render tab shows the last 200 lines.                                                                                                                                                       |

## 8. Security model

- Local only: loopback binding, loopback Host header required, same-origin `Origin` required on every change, no CORS, restrictive Content-Security-Policy.
- Every path is built by one path policy: no traversal, hidden names, control characters or symlinks inside the workspace.
- Uploads are typed from their bytes; unsafe SVGs are refused and served sandboxed; Markdown renders without raw HTML.
- Rendering runs in a child process started without a shell, with a minimal environment and a time limit.
- **Compositions are executable code.** Preview runs them in your browser tab and rendering runs them in headless Chrome. Motion Studio is not a sandbox: only preview or render code you or your trusted coding agent wrote or reviewed.

## 9. Known limitations

- One operator, one machine, one render at a time. No accounts, sharing or remote access by design.
- The studio runs under `pnpm dev` only; a production build of the studio is not supported.
- Thumbnails are the original images scaled in the browser; there is no thumbnail cache.
- Audio and video durations are not recorded in asset sidecars (they are probed at preflight).
- Asset usage is detected by searching source for stored file names; names built at runtime are not detected.
- Each asset listing re-hashes the folder, so very large video folders make the Assets tab slower.
- Props are flat: `props.schema.json` has no nested objects or arrays yet.
- Golden frames compare at the `standard` profile and may need a fresh baseline after upgrading Remotion or Chrome.
- Locating ffprobe uses Remotion's internal `RenderInternals` API, kept stable by the exact Remotion pin.
- The CookGuide production uses placeholder artwork and the non-resolving placeholder URL `https://cookguide.example/start` until the owner supplies approved ones.

## 10. Suggested version-two work

- Nested objects and lists in the props schema (for example a list of recipe steps).
- Thumbnail generation and probed media durations for assets.
- A render queue instead of "busy", and render presets per channel (for example 1080 × 1350 cut-downs).
- Approval per channel or profile (today one render per production is approved).
- Git LFS guidance tooling once repositories grow large.
