# Motion Studio Implementation Specification

**Version:** 1.0  
**Status:** Build ready  
**Audience:** Claude Code and the repository owner  
**Purpose:** Define the first production-capable version of a local-only workspace for organising, developing, previewing and rendering code-driven motion projects.

## 1. Executive decision

Build Motion Studio as a standalone, local-only repository. It is a creative production workspace, not a SaaS product and not a general-purpose nonlinear video editor. The repository owns project records, campaign records, production briefs, prompts, assets, source code, render settings and approved outputs. Git provides history and portability.

Use Astro for the management interface, React and Remotion for code-driven video compositions, and a small trusted local server boundary for filesystem and rendering operations. Plain files are the source of truth. Do not add a database, hosted API, user accounts, cloud storage, background service, message queue or deployment pipeline for version one.

The first release is complete when a CookGuide QR advert can be created from the UI, supplied with images and context, implemented by Claude Code as a Remotion composition, previewed with frame scrubbing, rendered deterministically to MP4, given a poster image, and retained with its inputs and render manifest under Git.

## 2. Product definition

Motion Studio helps one trusted local operator manage repeatable creative work. It provides the structure and tools; Claude Code authors or adjusts the animation code. The product must make every production understandable from its folder without requiring hidden application state.

### 2.1 Primary workflow

1. Create a project for a brand or product.
2. Add project context, brand guidance and reusable project assets.
3. Create a campaign with its objective and audience.
4. Create a production with title, description, format, duration and creative brief.
5. Upload or copy production-specific assets.
6. Save a Claude-ready implementation prompt with the production.
7. Ask Claude Code to implement the Remotion composition in the production folder.
8. Preview the composition locally and scrub to any frame.
9. Adjust the brief, prompt, assets or source and preview again.
10. Render a named profile to MP4 and generate a poster.
11. Keep render manifests and approved outputs in the production folder.

### 2.2 Explicit non-goals for version one

- Multi-user collaboration, permissions or authentication.
- Remote access, public URLs or cloud deployment.
- A browser-based timeline editor or drag-and-drop scene builder.
- Generative video models inside the application.
- Hosting or invoking Claude through an API.
- Cross-repository component imports as a core dependency.
- Automatic social-media publishing.
- A database or object storage layer.
- Rendering untrusted third-party code.
- Replacing product-specific animations that belong in product repositories.

## 3. Experience principles

- **Filesystem first.** Anything important must exist as a readable file under the repository.
- **Local and transparent.** The application binds to loopback and clearly shows paths and commands.
- **Code driven.** React and Remotion are the animation system; the UI manages the work around them.
- **Easy for Claude to understand.** Each production is self-contained and has a generated context packet.
- **Reproducible outputs.** Every render records the composition, profile, inputs, environment and result.
- **Useful before clever.** Prefer simple forms, clear validation and explicit state over automation magic.
- **Safe by default.** All path operations remain inside approved roots and uploaded files are treated as data.

## 4. Recommended repository architecture

Use a pnpm workspace so the local management application and Remotion runtime can evolve independently without becoming separate repositories.

```text
motion-studio/
├── apps/
│   └── studio/                     # Astro management UI and local API routes
├── packages/
│   ├── core/                       # Schemas, path policy, filesystem services
│   ├── motion-runtime/             # Remotion root, registry and shared motion primitives
│   └── ui/                         # Small optional shared React UI package
├── workspace/
│   └── projects/                   # All user-created creative work
├── scripts/                        # Validation, rendering and maintenance commands
├── docs/                           # Architecture and operator guidance
├── .motion-studio/
│   ├── settings.json               # Repository-local settings
│   ├── cache/                      # Rebuildable; gitignored
│   ├── jobs/                       # Ephemeral render state; gitignored
│   └── tmp/                        # Upload staging; gitignored
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

### 4.1 Technology choices

| Area | Choice | Reason |
|---|---|---|
| Management UI | Astro with React islands | Clean local pages with interactivity only where needed |
| Styling | CSS variables and scoped CSS | Avoid a large design dependency for an internal tool |
| Validation | Zod | One schema language for forms, files and API boundaries |
| Motion | Remotion and React | Programmatic animation, browser preview and deterministic render tooling |
| Local server operations | Astro server endpoints running in Node | Keeps privileged filesystem work out of browser code |
| Package manager | pnpm workspaces | Predictable monorepo dependency management |
| IDs | UUID v7 or ULID | Stable identity independent of display names and paths |
| Text records | Markdown with YAML front matter | Human-readable, Git-friendly briefs and prompts |
| Structured records | Versioned JSON | Strict validation for configuration and manifests |
| Testing | Vitest and Playwright | Unit, integration and browser acceptance coverage |

Pin Node, pnpm, Remotion and the browser used for rendering. Record them in the root package metadata and lockfile. Use exact versions for Remotion packages so preview and render packages cannot drift.

## 5. Runtime architecture

```text
Astro pages and React islands
        |
        | validated local HTTP requests
        v
Astro server endpoints
        |
        +--> Core filesystem services --> workspace/projects
        |
        +--> Preview registry ---------> Remotion Player
        |
        +--> Render service -----------> child process / Remotion CLI
                                             |
                                             +--> MP4, poster, manifest, logs
```

The browser must never receive arbitrary filesystem access. It sends IDs and validated form data to server endpoints. The server resolves those IDs through the catalog and path policy, then performs atomic writes.

### 5.1 Process model

- `pnpm dev` starts the Astro server on `127.0.0.1`, not `0.0.0.0`.
- Preview uses a Remotion Player embedded in a React island.
- Rendering runs as a child process with an argument array, never a shell-built command string.
- Version one permits one active render at a time. Additional requests are rejected with a clear busy response or placed in a simple in-memory FIFO that is lost safely on restart.
- The UI polls job status and reads bounded log output from `.motion-studio/jobs`.
- A render writes to a temporary output first and is atomically renamed only after validation succeeds.

## 6. Git-backed filesystem model

Display names are editable. Directory slugs are stable after creation unless a dedicated safe rename command is added later. IDs never change.

```text
workspace/projects/cookguide/
├── project.json
├── context.md
├── brand/
│   ├── brand.md
│   └── assets/
├── assets/
├── campaigns/
│   └── product-awareness/
│       ├── campaign.json
│       ├── brief.md
│       ├── assets/
│       └── productions/
│           └── qr-code-advert/
│               ├── production.json
│               ├── brief.md
│               ├── prompt.md
│               ├── notes.md
│               ├── assets/
│               ├── src/
│               │   ├── composition.tsx
│               │   ├── scenes/
│               │   └── styles.css
│               ├── tests/
│               ├── renders/
│               │   ├── manifests/
│               │   ├── previews/
│               │   └── final/
│               └── production.lock.json
```

### 6.1 Source-of-truth rules

- `project.json`, `campaign.json` and `production.json` are authoritative structured records.
- Markdown files contain prose and may have validated front matter, but must not duplicate mutable structured fields unless generated.
- The catalog is derived by scanning directories; it is not a second authoritative database.
- Cache entries may accelerate scans but must be deletable without data loss.
- `renders/manifests` and approved files in `renders/final` are committed unless the owner changes policy.
- Temporary previews, job state, upload staging and caches are ignored.
- Large source assets require an explicit repository policy. Start with normal Git; add Git LFS only if repository growth makes it necessary.

### 6.2 Naming rules

- Slugs use lowercase ASCII letters, digits and single hyphens.
- Reject reserved names, leading dots, empty segments and `..`.
- File names are normalised but original display names are retained in asset metadata.
- Resolve collisions with a short stable suffix, not silent overwrite.
- Never derive a trusted path by concatenating raw request data.

## 7. Data schemas

All JSON records include `schemaVersion`, a stable `id`, ISO 8601 timestamps and a revision integer. Unknown major schema versions fail closed with an actionable message.

### 7.1 Project schema

```ts
type ProjectRecord = {
  schemaVersion: 1;
  id: string;
  slug: string;
  name: string;
  description: string;
  status: "active" | "archived";
  sourceRepository?: {
    path: string;
    label?: string;
  };
  defaultRenderProfileId: string;
  contextFile: "context.md";
  brandFile?: "brand/brand.md";
  createdAt: string;
  updatedAt: string;
  revision: number;
};
```

`sourceRepository.path` is informational in version one. Do not automatically import code or execute commands there. If absolute paths reduce portability, support repository-relative aliases in `.motion-studio/settings.json`.

### 7.2 Campaign schema

```ts
type CampaignRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  slug: string;
  name: string;
  description: string;
  objective: string;
  audience: string[];
  keyMessages: string[];
  channels: string[];
  status: "draft" | "active" | "complete" | "archived";
  briefFile: "brief.md";
  createdAt: string;
  updatedAt: string;
  revision: number;
};
```

### 7.3 Production schema

```ts
type ProductionRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  campaignId: string;
  slug: string;
  title: string;
  description: string;
  status: "idea" | "briefing" | "in-development" | "review" | "approved" | "archived";
  compositionId: string;
  format: {
    width: number;
    height: number;
    fps: number;
    durationInFrames: number;
  };
  files: {
    brief: "brief.md";
    prompt: "prompt.md";
    notes: "notes.md";
    entry: "src/composition.tsx";
  };
  defaultRenderProfileId: string;
  posterFrame: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  revision: number;
};
```

`durationInFrames` is authoritative. The UI may show seconds as `durationInFrames / fps` and must round only for display.

### 7.4 Asset metadata schema

Store a sidecar file named `<asset-name>.asset.json` next to each uploaded asset.

```ts
type AssetRecord = {
  schemaVersion: 1;
  id: string;
  originalName: string;
  storedName: string;
  mediaType: "image" | "audio" | "video" | "font" | "document" | "other";
  mimeType: string;
  bytes: number;
  sha256: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
  source?: string;
  licenceNotes?: string;
  altText?: string;
  createdAt: string;
};
```

### 7.5 Render profile schema

Ship repository-level profiles in `.motion-studio/settings.json` and allow a production to select one by ID.

```ts
type RenderProfile = {
  id: string;
  name: string;
  container: "mp4";
  codec: "h264";
  pixelFormat: "yuv420p";
  crf: number;
  audioCodec: "aac";
  audioBitrate: string;
  concurrency: number;
  imageFormat: "jpeg" | "png";
  scale?: number;
  muted?: boolean;
};
```

Initial profiles:

| ID | Intended use | CRF | Scale | Notes |
|---|---|---:|---:|---|
| `draft` | Fast review | 28 | 0.5 | Faster render, visibly labelled draft |
| `standard` | Normal approval | 20 | 1 | Default H.264 MP4 |
| `high-quality` | Final master | 16 | 1 | Slower and larger |

### 7.6 Render manifest schema

```ts
type RenderManifest = {
  schemaVersion: 1;
  renderId: string;
  productionId: string;
  compositionId: string;
  profileId: string;
  requestedAt: string;
  startedAt: string;
  completedAt: string;
  status: "succeeded" | "failed" | "cancelled";
  inputFingerprint: string;
  git?: { commit?: string; dirty: boolean };
  environment: {
    node: string;
    pnpm: string;
    remotion: string;
    platform: string;
    architecture: string;
  };
  video: {
    relativePath: string;
    sha256: string;
    bytes: number;
    width: number;
    height: number;
    fps: number;
    durationInFrames: number;
    durationSeconds: number;
    codec: string;
    pixelFormat: string;
  };
  poster?: {
    relativePath: string;
    frame: number;
    sha256: string;
  };
  warnings: string[];
  error?: { code: string; message: string };
};
```

The input fingerprint must be calculated from canonical production configuration, selected profile, composition source files, referenced asset hashes and lockfile hash. Timestamps are excluded. Identical inputs and environment should produce the same fingerprint even though encoded MP4 bytes may vary across operating systems or encoder builds.

## 8. Markdown documents and Claude handoff

### 8.1 Project context

`context.md` explains the product, audience, terminology, claims that may be made, claims that must not be made, preferred tone, brand constraints and relevant repository path. It should be useful without opening the management UI.

### 8.2 Production brief

Use this required structure in `brief.md`:

```md
# Production title

## Objective
## Audience
## Single key message
## Call to action
## Format and duration
## Narrative and scenes
## Required content
## Prohibited content
## Visual direction
## Audio direction
## Accessibility
## Deliverables
## Acceptance criteria
```

### 8.3 Saved Claude prompt

`prompt.md` is a human-edited implementation request. The UI also generates a copyable context packet that combines:

- Repository architecture and allowed edit boundary.
- Project and campaign summaries.
- Production record and render profile.
- Full project context and production brief.
- Asset inventory with repository-relative paths and hashes.
- Existing source file inventory.
- Commands for validation, preview and render.
- A requirement to keep all production-specific code inside the production folder unless shared runtime changes are explicitly justified.
- A requirement not to commit or push.

Do not silently overwrite `prompt.md` when regenerating. Show a diff or save a timestamped candidate under a gitignored temporary folder, then let the operator replace the saved prompt deliberately.

## 9. Management interface

Keep the visual language calm and production-oriented: neutral surfaces, strong type hierarchy, restrained colour and clear status labels. Optimise for a desktop viewport while remaining usable on a tablet.

### 9.1 Screens

**Dashboard**

- Lists projects, recent productions and recent successful or failed renders.
- Shows validation problems without blocking navigation.
- Provides create-project action.

**Project page**

- Shows project summary, context completeness, brand assets and campaigns.
- Edits structured metadata and Markdown context separately.
- Provides safe access to the source repository path as text only.

**Campaign page**

- Shows objective, audience, key messages, shared assets and productions.
- Provides create-production action.

**Production workspace**

- Header: title, status, format, duration and validation state.
- Brief tab: Markdown editor with rendered preview.
- Prompt tab: Markdown editor, generated context packet preview and copy action.
- Assets tab: upload, metadata, thumbnail, hash and usage information.
- Preview tab: Remotion Player, play/pause, current frame, timecode, scrubber, frame step, volume and scale-to-fit.
- Render tab: profile selector, preflight results, render action, live progress, bounded logs, cancel action and output history.
- Files tab: repository-relative file tree and open/copy-path actions; no arbitrary filesystem explorer.

### 9.2 Editing behaviour

- Forms validate before save and display field-specific errors.
- Markdown autosave is optional; default to explicit Save for version one.
- Save operations include the record revision. A stale revision returns a conflict rather than overwriting newer content.
- Atomic writes use a sibling temporary file followed by rename.
- Destructive actions require confirmation and default to moving records to an internal archive rather than deletion.

### 9.3 Preview behaviour

- Resolve the selected production to an allowlisted composition module.
- Read width, height, FPS and duration from `production.json`.
- Support exact frame entry and keyboard stepping by one frame.
- Scrubbing updates visual state without altering source files.
- The preview displays a useful error overlay when compilation or runtime rendering fails.
- Use the same input props and asset resolver used by headless rendering.
- Never use current time, network data or unseeded randomness inside a composition.

## 10. Remotion development model

### 10.1 Composition registry

Create a generated registry file from validated production records. The registry maps stable `compositionId` values to explicit module imports. Regenerate it on startup and after production creation. Do not use an unrestricted dynamic import constructed from a URL parameter.

### 10.2 Production entry contract

Each `src/composition.tsx` exports:

```ts
export const composition: MotionStudioComposition = {
  id: "cookguide-qr-code-advert",
  Component: CookGuideQrAdvert,
  defaultProps: {},
};
```

`MotionStudioComposition` is defined by `packages/motion-runtime`. Shared runtime components may include safe-area guides, typography helpers, transitions, QR display helpers and deterministic easing utilities. Add shared abstractions only after at least two genuine uses or when they enforce a safety or consistency rule.

### 10.3 Determinism requirements

- Animation state derives from `useCurrentFrame`, FPS, props and local assets.
- Random values use a stable seeded helper.
- Network requests during preview and render are prohibited.
- Fonts are stored locally and explicitly loaded.
- Locale-sensitive formatting specifies a locale and time zone.
- Dates are passed as fixed props, not read from the machine clock.
- Asset lookup uses repository-relative paths through one resolver.
- Rendering fails if referenced assets are missing or hashes no longer match the manifest used at render start.

### 10.4 Media handling

Use Remotion media components and local static assets. Preload where appropriate. Validate that audio and video assets can be probed before a render begins. Preserve original uploads; derived optimised files must have their own metadata and must not overwrite the original.

## 11. Render pipeline

### 11.1 Preflight

Before starting a render:

1. Validate project, campaign and production schemas.
2. Confirm the entry module is registered and compiles.
3. Confirm dimensions, FPS and frame duration are within configured limits.
4. Resolve all referenced assets and verify hashes.
5. Check poster frame is within range.
6. Confirm the profile is known.
7. Check required tools and pinned package versions.
8. Check output and temporary directories are writable.
9. Record Git commit and dirty state when available.
10. Calculate the input fingerprint.

Warnings may allow an operator to continue; errors must block rendering.

### 11.2 Render execution

- Create a unique render ID and immutable job request.
- Spawn the rendering tool without a shell and with a minimal environment.
- Stream structured progress to a bounded job log.
- Write `<render-id>.partial.mp4` under the temporary job directory.
- Probe the finished file for codec, dimensions, frame rate, duration and pixel format.
- Render the poster from the configured frame using the same source and props.
- Calculate output hashes.
- Write the final manifest.
- Atomically move successful files into `renders/final` and the manifest into `renders/manifests`.
- Remove partial files after failure or cancellation; retain a small diagnostic log outside committed output.

### 11.3 File naming

Use an unambiguous convention:

```text
YYYYMMDD-HHmmss_<production-slug>_<profile-id>_<fingerprint-8>.mp4
YYYYMMDD-HHmmss_<production-slug>_<profile-id>_<fingerprint-8>-poster.png
YYYYMMDD-HHmmss_<production-slug>_<profile-id>_<fingerprint-8>.render.json
```

### 11.4 Cancellation and recovery

- Store the child process ID only in ephemeral job state.
- Cancel sends a graceful termination first and escalates after a short timeout.
- On startup, mark any previously running job as interrupted and clean its partial outputs.
- Never delete completed renders automatically.

## 12. Local API surface

The exact URLs may change, but the service boundary should support these operations:

| Method and route | Purpose |
|---|---|
| `GET /api/catalog` | Return validated project, campaign and production summaries |
| `POST /api/projects` | Create a project folder and starter files |
| `PATCH /api/projects/:id` | Update project metadata with revision check |
| `POST /api/projects/:id/campaigns` | Create a campaign |
| `POST /api/campaigns/:id/productions` | Create a production scaffold |
| `GET/PUT /api/documents/:scope/:id/:kind` | Read or save an allowlisted Markdown document |
| `POST /api/assets/:scope/:id` | Upload a validated asset |
| `DELETE /api/assets/:scope/:id/:assetId` | Move an unused asset to archive after confirmation |
| `POST /api/productions/:id/preflight` | Return errors, warnings and fingerprint |
| `POST /api/productions/:id/renders` | Start a render using a named profile |
| `GET /api/renders/:renderId` | Return status, progress and bounded logs |
| `POST /api/renders/:renderId/cancel` | Cancel the active job |
| `POST /api/productions/:id/poster` | Generate or regenerate the poster |
| `GET /api/productions/:id/context-packet` | Generate Claude-ready context text |

Every write endpoint validates content type, request size, ID format, schema, revision and resolved path. Return stable machine-readable error codes plus a user-facing message.

## 13. Security and trust boundary

This is local software, but it still handles uploaded files and executes production source code. Treat the repository owner as trusted and all file names, metadata and uploaded bytes as untrusted data.

### 13.1 Network controls

- Bind only to `127.0.0.1` by default.
- Refuse non-loopback host headers unless an explicit development override is set.
- Set a strict origin check on mutation requests.
- Do not add permissive CORS headers.
- Do not fetch remote URLs on behalf of the browser.

### 13.2 Filesystem controls

- Centralise canonical path resolution in `packages/core`.
- Resolve symlinks and confirm both parent and final target remain under an allowed root.
- Reject absolute user-supplied paths, traversal segments, null bytes and hidden control characters.
- Use allowlists for document names and file extensions.
- Set upload and total project size limits in settings.
- Detect MIME type from bytes where practical; never trust the browser-provided type alone.
- Never overwrite an existing asset without an explicit replace operation.

### 13.3 Process controls

- Use `spawn` or equivalent with an executable plus argument array.
- Never pass user text through `sh -c`, command interpolation or an eval-like facility.
- Limit render concurrency, resolution, duration and process lifetime.
- Redact environment secrets from logs and manifests.
- Pass only required environment variables to the child process.

### 13.4 Browser and content controls

- Render Markdown with raw HTML disabled or sanitised.
- Use a restrictive Content Security Policy compatible with local preview needs.
- Serve assets by opaque ID or validated relative path, not arbitrary file URLs.
- Do not execute uploaded SVG scripts; sanitise SVG or rasterise it before use.
- Do not expose stack traces containing private absolute paths in the normal UI.

### 13.5 Execution trust statement

Remotion composition code is executable local code. Motion Studio is not a sandbox for third-party projects. The UI must state this clearly. Only source authored or reviewed by the repository owner or their trusted coding agent should be previewed or rendered.

## 14. Git policy

Motion Studio may display Git state and suggest commands, but version one must not automatically commit, push, pull, reset, clean or change branches.

Recommended committed content:

- Application and runtime source.
- Workspace JSON and Markdown records.
- Brand and production assets that comply with repository size policy.
- Production source and tests.
- Successful render manifests.
- Approved final outputs if the owner wants them versioned.

Recommended ignored content:

```gitignore
.motion-studio/cache/
.motion-studio/jobs/
.motion-studio/tmp/
**/renders/previews/
**/*.partial.mp4
**/.DS_Store
```

Do not ignore briefs, prompts, source, asset sidecars or manifests.

## 15. Validation and testing strategy

### 15.1 Unit tests

- Slug normalisation and collision handling.
- Schema parsing and version rejection.
- Path traversal and symlink escape prevention.
- Atomic file writes and revision conflicts.
- Asset hashing and metadata extraction.
- Fingerprint stability and sensitivity to relevant changes.
- Render profile argument construction.
- Frame and timecode conversion.

### 15.2 Integration tests

- Create project, campaign and production and confirm exact scaffold.
- Restart the app and rebuild the catalog from disk.
- Upload valid and invalid assets.
- Generate the registry and load a composition.
- Run preflight with missing assets, bad source and valid source.
- Render a short fixture composition and probe its output.
- Cancel a long fixture render and verify cleanup.
- Simulate a stale job at startup and verify recovery.

### 15.3 Browser tests

- Complete the create flow using only the UI.
- Edit and save a brief and prompt.
- Preview, play, pause, scrub and step frames.
- See compile errors without losing navigation.
- Select a render profile, render, follow progress and open output details.
- Verify keyboard accessibility and visible focus for core controls.

### 15.4 Golden frame tests

For critical compositions, render selected frames to PNG and compare with committed baselines using a documented tolerance. Use frames at scene boundaries as well as representative mid-scene frames. Baseline updates require deliberate review.

## 16. Milestones

### Milestone 0 Repository foundation

Deliver:

- pnpm workspace and pinned toolchain.
- Astro application, React integration and base styling.
- Core Zod schemas and repository settings.
- Sample fixture data outside the future CookGuide acceptance project.
- Formatting, type-checking and test commands.

Exit criteria:

- A fresh clone installs with one documented command.
- `pnpm check` and unit tests pass.
- The app starts on loopback and displays the fixture catalog.

### Milestone 1 Filesystem domain and CRUD

Deliver:

- Safe path policy, atomic file store and catalog scanner.
- Project, campaign and production creation screens.
- Metadata and Markdown editing.
- Revision conflict handling and archive behaviour.

Exit criteria:

- A user can create the full hierarchy from the UI.
- Restarting loses no data and requires no migration service.
- All persisted records validate from a clean scan.

### Milestone 2 Asset library and context packet

Deliver:

- Scoped uploads for project, campaign and production assets.
- Sidecar metadata, hashes, thumbnail display and validation.
- Project context, brief and prompt templates.
- Generated Claude context packet with asset and source inventory.

Exit criteria:

- Duplicate names cannot overwrite data.
- Traversal and disallowed file tests pass.
- A production folder alone contains enough information for Claude to begin work.

### Milestone 3 Remotion preview

Deliver:

- Motion runtime package and generated composition registry.
- Production scaffold with working placeholder composition.
- Embedded player with playback, scrubbing, exact frame navigation and error overlay.
- Shared deterministic asset and font loading.

Exit criteria:

- A newly created production previews without manual wiring.
- Preview uses the production dimensions, FPS and duration.
- Refresh and restart preserve the composition mapping.

### Milestone 4 Rendering and posters

Deliver:

- Preflight service, render profiles and single-job controller.
- MP4 render, progress, cancellation, probing and cleanup.
- Poster rendering, manifests and input fingerprinting.
- Output history in the UI.

Exit criteria:

- A valid production produces a playable H.264 MP4 with `yuv420p` pixel format.
- The probed output matches configured dimensions, FPS and duration within encoder tolerance.
- Failed or cancelled renders never appear as completed outputs.

### Milestone 5 Hardening and CookGuide acceptance

Deliver:

- Security checks, limits and safe error handling.
- Unit, integration, browser and golden-frame coverage.
- Operator README and troubleshooting guide.
- First CookGuide QR advert and approved render.

Exit criteria:

- All acceptance tests in section 17 pass from a clean clone.
- No high-severity security or data-loss defect remains open.

## 17. First acceptance production CookGuide QR advert

The acceptance project proves the system rather than merely demonstrating a sample animation.

### 17.1 Production setup

Create:

```text
Project: CookGuide
Campaign: QR Awareness
Production: CookGuide QR Code Advert
Format: 1080 x 1920 portrait
FPS: 30
Duration: 12 seconds / 360 frames
Poster frame: 300
Default profile: standard
```

Required production assets:

- CookGuide logo or approved wordmark.
- One phone or interface visual showing the CookGuide experience.
- A generated QR code that resolves to an explicitly configured CookGuide URL.
- Optional food imagery with recorded source and licence notes.

Do not hard-code a live destination in the component. Store it in production props or configuration. For acceptance, use an owner-approved HTTPS URL and verify the QR payload exactly.

### 17.2 Creative outline

| Frames | Time | Purpose | Minimum content |
|---:|---:|---|---|
| 0-59 | 0.0-2.0s | Hook | A concise cooking problem or need; immediate CookGuide visual identity |
| 60-179 | 2.0-6.0s | Value | Product or recipe guidance visual with one clear benefit |
| 180-269 | 6.0-9.0s | Transition to action | Phone/interface resolves into a stable action area |
| 270-359 | 9.0-12.0s | Call to action | Large scannable QR code, CookGuide identity and short instruction |

The QR code must be fully static for the final three seconds, have a four-module quiet zone, strong contrast, no decorative overlap, and enough rendered size for reliable scanning from a paused 1080 x 1920 frame.

### 17.3 Creative acceptance criteria

- The opening message is understandable within two seconds.
- The advert communicates one benefit and one call to action.
- Text remains inside a defined safe area and is legible on a phone-sized preview.
- No scene relies on rapid flashing or motion that undermines comprehension.
- The CookGuide name or logo is present but does not obstruct the QR code.
- The final frame works as the generated poster unless the operator deliberately selects another compliant frame.
- Audio, if included, is optional to comprehension and has no clipping.

### 17.4 Technical acceptance test

From a clean clone on the documented supported machine:

1. Install dependencies with the pinned package manager.
2. Start Motion Studio and confirm it binds to loopback.
3. Open the CookGuide production and confirm all schemas and assets validate.
4. Preview from frame 0 and scrub to frames 60, 180, 270 and 359 without an application error.
5. Step forward and backward by one frame and confirm the displayed frame number is exact.
6. Run preflight with the `standard` profile and receive no errors.
7. Render the MP4 and poster through the UI.
8. Confirm the MP4 is 1080 x 1920, 30 FPS, approximately 12 seconds, H.264 and `yuv420p`.
9. Confirm there are exactly 360 intended frames in production configuration and no blank final frame caused by an off-by-one error.
10. Confirm the poster is 1080 x 1920 and represents frame 300.
11. Scan the QR code from the poster and from at least one paused playback frame; both must resolve to the configured URL.
12. Confirm the output, poster and manifest hashes exist and match their files.
13. Confirm the manifest records the profile, fingerprint, versions and Git dirty state.
14. Render again without changing inputs; confirm the input fingerprint is unchanged and the visible golden frames match.
15. Change one referenced asset; confirm the fingerprint changes and the old render remains intact.

### 17.5 Failure acceptance tests

- A missing QR asset blocks render with a useful error.
- A poster frame of 360 or greater is rejected.
- A filename containing traversal syntax cannot escape the asset directory.
- A second simultaneous render cannot corrupt the first.
- Cancelling a render removes its partial MP4 and does not create a successful manifest.
- A composition runtime error is visible in preview and blocks render preflight.

## 18. Definition of done for version one

Version one is done only when all of the following are true:

- Projects, campaigns and productions can be created and maintained entirely through the UI.
- Every important item is represented by a readable repository file.
- Project context, briefs and prompts are editable Markdown.
- Assets are safely uploaded, hashed and inventoried.
- Claude receives a complete context packet and can implement within a predictable folder.
- A production can be previewed, scrubbed and frame-stepped.
- Named profiles render deterministic-input MP4s and posters.
- Render manifests make outputs traceable to their inputs and environment.
- The application survives restart and reconstructs state from disk.
- Security controls prevent traversal, unintended network exposure and shell injection.
- The CookGuide QR advert acceptance test passes.
- Documentation explains installation, normal operation, backup, recovery and known limitations.

## 19. Claude Code implementation instructions

Use this section as the controlling build brief.

1. Read this specification fully before changing files.
2. Inspect the repository and preserve existing conventions where they do not conflict with the specification.
3. Implement milestones in order and keep each milestone runnable.
4. Use plain files as the only authoritative persistence layer.
5. Keep privileged filesystem and process operations on the Astro server side.
6. Build one central path-policy module and route every filesystem operation through it.
7. Validate all persisted and incoming data with shared Zod schemas.
8. Use atomic writes and revision checks for mutable records.
9. Scaffold every production with a previewable placeholder Remotion composition.
10. Keep composition discovery explicit and allowlisted through a generated registry.
11. Make preview and render consume the same record, props and asset resolver.
12. Spawn render commands without a shell and validate final media with a probe step.
13. Keep render jobs single-concurrency for version one.
14. Add automated tests alongside each domain service and user flow.
15. Do not add a database, authentication, Docker, cloud services, telemetry or deployment configuration unless separately requested.
16. Do not commit or push. At the end of each milestone, show changed files, commands run, test results, remaining risks and the next milestone.

### 19.1 Required root commands

Implement and document these commands:

```text
pnpm dev                 Start the local studio
pnpm check               Run type checks and framework checks
pnpm test                Run unit and integration tests
pnpm test:e2e            Run browser acceptance tests
pnpm lint                Run static analysis
pnpm format              Format supported files
pnpm validate:workspace  Validate every project record and reference
pnpm render -- <production-id> --profile <profile-id>
pnpm poster -- <production-id> --frame <frame-number>
```

### 19.2 First implementation sequence

- Create schemas and path policy before UI forms.
- Create fixture folders and catalog scanning before mutation endpoints.
- Add atomic creation services, then connect the create forms.
- Add Markdown editing and asset handling.
- Add the Remotion runtime and placeholder composition.
- Add preflight and command construction with tests before executing a real render.
- Add output probing, manifests and recovery.
- Build the CookGuide production last, using the finished workflow rather than hand-placing files that the UI cannot manage.

## 20. Delivery checklist for the implementing agent

At completion, provide:

- A concise architecture summary and any justified deviations.
- The final repository tree for important paths.
- Exact local setup and startup commands.
- A description of where project data and outputs are stored.
- Test and validation results.
- The CookGuide advert output details and QR verification result.
- Known limitations and recommended version-two work.
- A list of uncommitted changes for owner review.

Do not commit or push without the repository owner's explicit confirmation.
