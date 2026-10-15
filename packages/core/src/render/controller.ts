import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:fs";
import {
  appendFile,
  copyFile,
  link,
  mkdir,
  open,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { hashFile, type AssetLibrary } from "../assets.ts";
import { MotionStudioError } from "../errors.ts";
import { serializeJson, writeJsonAtomic } from "../fs-store.ts";
import { toRepoRelative } from "../repo.ts";
import {
  posterManifestSchema,
  renderManifestSchema,
  type PosterManifest,
  type RenderManifest,
} from "../schemas/render-manifest.ts";
import type { ProductionRecord } from "../schemas/production.ts";
import type { RenderProfile } from "../schemas/render-profile.ts";
import type { WorkspaceService } from "../workspace.ts";
import { renderEnvironment } from "./environment.ts";
import { assetChain, computeFingerprint, gatherFingerprintInputs } from "./fingerprint.ts";
import { isRenderId, outputNames, posterOnlyNames, renderBaseName } from "./naming.ts";
import { mediaRenderOptions, outputSize, sampleFrames } from "./options.ts";
import { runPreflight, type PreflightResult } from "./preflight.ts";
import { probeImage, probeVideo, videoProblems } from "./probe.ts";
import {
  renderEntrySource,
  type RenderPhase,
  type RenderRequest,
  type WorkerMessage,
} from "./request.ts";

export type JobStatus = "running" | "succeeded" | "failed" | "cancelled" | "interrupted";

export type JobState = {
  schemaVersion: 1;
  renderId: string;
  kind: "render" | "poster";
  productionId: string;
  productionSlug: string;
  profileId: string;
  fingerprint: string;
  status: JobStatus;
  phase: RenderPhase;
  /** Overall progress, 0 to 1. */
  progress: number;
  renderedFrames?: number;
  totalFrames: number;
  requestedAt: string;
  startedAt: string;
  completedAt?: string;
  /** Ephemeral: only meaningful while the job runs. */
  pid?: number;
  error?: { code: string; message: string };
  /** Repository-relative paths of the committed outputs. */
  outputs?: { video?: string; poster: string; manifest: string };
  warnings: string[];
};

export type JobView = { state: JobState; log: string[] };

export type HistoryEntry =
  | { kind: "render"; manifest: RenderManifest; manifestPath: string }
  | { kind: "poster"; manifest: PosterManifest; manifestPath: string };

export class PreflightFailedError extends MotionStudioError {
  readonly result: PreflightResult;

  constructor(result: PreflightResult) {
    const failures = result.checks
      .filter((check) => check.status === "fail")
      .map((check) => check.label);
    super("PREFLIGHT_FAILED", `Preflight failed: ${failures.join(", ")}`);
    this.result = result;
  }
}

const LOG_LINES_IN_MEMORY = 500;
const LOG_FILE_LIMIT = 1024 * 1024;
const LOCK_FILE = "active.lock";

/** Overall progress band for each worker phase. */
const PHASE_BANDS: Record<RenderPhase, [number, number]> = {
  queued: [0, 0],
  preflight: [0, 0.02],
  browser: [0.02, 0.05],
  bundling: [0.05, 0.15],
  checking: [0.15, 0.2],
  rendering: [0.2, 0.95],
  poster: [0.95, 0.98],
  finalising: [0.98, 1],
  done: [1, 1],
};

type Active = {
  state: JobState;
  child: ChildProcess;
  log: string[];
  jobDir: string;
  request: RenderRequest;
  preflight: PreflightResult;
  profile: RenderProfile;
  production: ProductionRecord;
  productionDir: string;
  cancelRequested: boolean;
  timedOut: boolean;
  workerError?: { code: string; message: string };
  done: boolean;
  finished: Promise<JobState>;
};

export type ControllerOptions = {
  /** Path to the worker script. Defaults to scripts/render-worker.ts in the repository. */
  workerScript?: string;
  /** Grace period between SIGTERM and SIGKILL on cancel. */
  killTimeoutMs?: number;
};

/**
 * Runs one render at a time across every Motion Studio process on the
 * machine (an exclusive lock file), supervises the worker, and turns a
 * successful worker run into validated, hashed outputs and a manifest.
 * Failed or cancelled jobs never produce a manifest.
 */
export class RenderController {
  readonly #workspace: WorkspaceService;
  readonly #assets: AssetLibrary;
  readonly #workerScript: string;
  readonly #killTimeoutMs: number;
  #active: Active | undefined;

  constructor(workspace: WorkspaceService, assets: AssetLibrary, options: ControllerOptions = {}) {
    this.#workspace = workspace;
    this.#assets = assets;
    this.#workerScript =
      options.workerScript ?? path.join(workspace.repoRoot, "scripts", "render-worker.ts");
    this.#killTimeoutMs = options.killTimeoutMs ?? 5000;
  }

  get activeRenderId(): string | undefined {
    return this.#active && !this.#active.done ? this.#active.state.renderId : undefined;
  }

  /**
   * Mark jobs left running by a previous process as interrupted and delete
   * their partial outputs. Completed renders are never touched.
   */
  async recover(): Promise<string[]> {
    const recovered: string[] = [];
    for (const entry of await readdir(this.#workspace.jobsRoot, { withFileTypes: true }).catch(
      () => [],
    )) {
      if (!entry.isDirectory() || !isRenderId(entry.name)) continue;
      if (this.#active?.state.renderId === entry.name) continue;
      const jobDir = this.#workspace.policy.resolve(this.#workspace.jobsRoot, entry.name);
      const state = await readJobState(jobDir);
      if (!state || state.status !== "running") continue;
      const { pid: _pid, ...rest } = state;
      await writeJsonAtomic(path.join(jobDir, "job.json"), {
        ...rest,
        status: "interrupted",
        completedAt: this.#workspace.timestamp(),
        error: {
          code: "INTERRUPTED",
          message: "Motion Studio stopped while this render was running",
        },
      } satisfies JobState);
      await cleanPartials(jobDir);
      recovered.push(entry.name);
    }
    await this.#releaseStaleLock();
    return recovered;
  }

  /** Preflight without starting anything. */
  preflight(productionId: string, profileId: string): Promise<PreflightResult> {
    return runPreflight(this.#workspace, this.#assets, productionId, profileId);
  }

  /** Start a render (or a poster-only render). Throws BUSY or PREFLIGHT_FAILED. */
  async start(options: {
    productionId: string;
    profileId: string;
    kind?: "render" | "poster";
    frame?: number;
  }): Promise<JobState> {
    const kind = options.kind ?? "render";
    if (this.activeRenderId) throw busy(this.activeRenderId);
    await this.#acquireLock("pending");
    try {
      const preflight = await this.preflight(options.productionId, options.profileId);
      if (!preflight.ok || !preflight.fingerprint) throw new PreflightFailedError(preflight);

      const { dir: productionDir, record } = await this.#workspace.locate(
        "production",
        options.productionId,
      );
      const production = record as ProductionRecord;
      const profile = this.#workspace.settings.renderProfiles.find(
        (p) => p.id === options.profileId,
      )!;
      const lastFrame = production.format.durationInFrames - 1;
      const posterFrame = options.frame ?? production.posterFrame;
      if (!Number.isInteger(posterFrame) || posterFrame < 0 || posterFrame > lastFrame) {
        throw new MotionStudioError("INVALID_INPUT", `Frame must be between 0 and ${lastFrame}`);
      }

      const requestedAt = this.#workspace.now();
      const renderId = await this.#uniqueRenderId(
        renderBaseName(requestedAt, production.slug, profile.id, preflight.fingerprint),
      );
      await this.#acquireLock(renderId, true);
      const jobDir = this.#workspace.policy.resolve(this.#workspace.jobsRoot, renderId);
      await mkdir(jobDir, { recursive: true });

      const publicDir = path.join(jobDir, "public");
      await this.#stageAssets(options.productionId, publicDir);

      const entryFile = this.#workspace.policy.resolveRelative(
        productionDir,
        production.files.entry,
      );
      let entryImport = path.relative(jobDir, entryFile).split(path.sep).join("/");
      if (!entryImport.startsWith(".")) entryImport = `./${entryImport}`;
      const bundleEntry = path.join(jobDir, "entry.tsx");
      await writeExclusive(
        bundleEntry,
        renderEntrySource({
          entryImport,
          entryLabel: toRepoRelative(this.#workspace.repoRoot, entryFile),
          compositionId: production.compositionId,
          format: production.format,
        }),
      );

      const props = await this.#workspace.readProductionProps(options.productionId);
      const request: RenderRequest = {
        schemaVersion: 1,
        renderId,
        kind,
        productionId: production.id,
        compositionId: production.compositionId,
        profileId: profile.id,
        format: production.format,
        options: mediaRenderOptions(profile),
        posterFrame,
        sampleFrames: sampleFrames(production.format.durationInFrames, posterFrame),
        inputProps: props.props,
        bundleEntry,
        publicDir,
        bundleDir: path.join(jobDir, "bundle"),
        smokeDir: path.join(jobDir, "smoke"),
        outputs: {
          ...(kind === "render" ? { video: path.join(jobDir, `${renderId}.partial.mp4`) } : {}),
          poster: path.join(jobDir, `${renderId}.partial.png`),
        },
        frameTimeoutMs: 30_000,
      };
      const requestPath = path.join(jobDir, "request.json");
      await writeExclusive(requestPath, serializeJson(request));

      const state: JobState = {
        schemaVersion: 1,
        renderId,
        kind,
        productionId: production.id,
        productionSlug: production.slug,
        profileId: profile.id,
        fingerprint: preflight.fingerprint,
        status: "running",
        phase: "preflight",
        progress: PHASE_BANDS.preflight[1],
        totalFrames: kind === "render" ? production.format.durationInFrames : 1,
        requestedAt: requestedAt.toISOString(),
        startedAt: this.#workspace.timestamp(),
        warnings: preflight.checks
          .filter((check) => check.status === "warn")
          .flatMap((check) => check.messages.map((message) => `${check.label}: ${message}`)),
      };
      return await this.#launch({
        state,
        jobDir,
        request,
        requestPath,
        preflight,
        profile,
        production,
        productionDir,
      });
    } catch (error) {
      await this.#releaseLock();
      throw error;
    }
  }

  /** Current state and recent log lines. */
  async get(renderId: string): Promise<JobView> {
    if (!isRenderId(renderId)) throw new MotionStudioError("NOT_FOUND", "Unknown render");
    if (this.#active?.state.renderId === renderId) {
      return { state: { ...this.#active.state }, log: [...this.#active.log] };
    }
    const jobDir = this.#workspace.policy.resolve(this.#workspace.jobsRoot, renderId);
    const state = await readJobState(jobDir);
    if (!state) throw new MotionStudioError("NOT_FOUND", "Unknown render");
    const log = await readFile(path.join(jobDir, "log.txt"), "utf8").catch(() => "");
    return { state, log: log.split("\n").filter(Boolean).slice(-LOG_LINES_IN_MEMORY) };
  }

  /** Resolve when the given running job finishes. */
  async wait(renderId: string): Promise<JobState> {
    if (this.#active?.state.renderId === renderId) return this.#active.finished;
    return (await this.get(renderId)).state;
  }

  /** Ask the worker to stop: SIGTERM, then SIGKILL after the grace period. */
  async cancel(renderId: string): Promise<JobState> {
    const active = this.#active;
    if (!active || active.state.renderId !== renderId || active.done) {
      throw new MotionStudioError("NOT_FOUND", "That render is not running");
    }
    this.#terminate(active, "cancel");
    return { ...active.state };
  }

  /** Successful manifests for a production, newest first, plus recent unsuccessful jobs. */
  async history(
    productionId: string,
  ): Promise<{ outputs: HistoryEntry[]; jobs: JobState[]; problems: string[] }> {
    const { dir } = await this.#workspace.locate("production", productionId);
    const manifestsDir = this.#workspace.policy.resolve(dir, "renders", "manifests");
    const outputs: HistoryEntry[] = [];
    const problems: string[] = [];
    for (const name of (await readdir(manifestsDir).catch(() => [])).sort().reverse()) {
      const kind = name.endsWith(".render.json")
        ? "render"
        : name.endsWith(".poster.json")
          ? "poster"
          : undefined;
      if (!kind) continue;
      const file = path.join(manifestsDir, name);
      try {
        const data: unknown = JSON.parse(await readFile(file, "utf8"));
        const manifestPath = toRepoRelative(this.#workspace.repoRoot, file);
        if (kind === "render")
          outputs.push({ kind, manifest: renderManifestSchema.parse(data), manifestPath });
        else outputs.push({ kind, manifest: posterManifestSchema.parse(data), manifestPath });
      } catch {
        problems.push(`${toRepoRelative(this.#workspace.repoRoot, file)} is not a valid manifest`);
      }
    }
    outputs.sort((a, b) => b.manifest.completedAt.localeCompare(a.manifest.completedAt));

    const jobs: JobState[] = [];
    for (const entry of (
      await readdir(this.#workspace.jobsRoot, { withFileTypes: true }).catch(() => [])
    ).reverse()) {
      if (!entry.isDirectory() || !isRenderId(entry.name)) continue;
      const state =
        this.#active?.state.renderId === entry.name
          ? this.#active.state
          : await readJobState(path.join(this.#workspace.jobsRoot, entry.name));
      if (state?.productionId === productionId && state.status !== "succeeded") jobs.push(state);
      if (jobs.length >= 10) break;
    }
    return { outputs, jobs, problems };
  }

  /** Resolve a finished output file for serving: it must be named by a valid manifest of this production. */
  async outputFile(
    productionId: string,
    fileName: string,
  ): Promise<{ file: string; mimeType: string }> {
    const { outputs } = await this.history(productionId);
    const { dir } = await this.#workspace.locate("production", productionId);
    for (const entry of outputs) {
      const candidates = [
        ...(entry.kind === "render"
          ? [{ relative: entry.manifest.video.relativePath, mimeType: "video/mp4" }]
          : []),
        ...(entry.manifest.poster
          ? [{ relative: entry.manifest.poster.relativePath, mimeType: "image/png" }]
          : []),
      ];
      const match = candidates.find(
        (candidate) => path.posix.basename(candidate.relative) === fileName,
      );
      if (match)
        return {
          file: this.#workspace.policy.resolveRelative(dir, match.relative),
          mimeType: match.mimeType,
        };
    }
    throw new MotionStudioError("NOT_FOUND", "No such output");
  }

  // ---------------------------------------------------------------- running

  async #launch(job: {
    state: JobState;
    jobDir: string;
    request: RenderRequest;
    requestPath: string;
    preflight: PreflightResult;
    profile: RenderProfile;
    production: ProductionRecord;
    productionDir: string;
  }): Promise<JobState> {
    const child = spawn(process.execPath, [this.#workerScript, job.requestPath], {
      cwd: this.#workspace.repoRoot,
      env: workerEnvironment(),
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let resolveFinished!: (state: JobState) => void;
    const active: Active = {
      ...job,
      child,
      log: [],
      cancelRequested: false,
      timedOut: false,
      done: false,
      finished: new Promise((resolve) => (resolveFinished = resolve)),
    };
    this.#active = active;
    active.state.pid = child.pid;
    await this.#persist(active);
    await this.#log(
      active,
      `Render ${job.state.renderId} started (${job.state.kind}, profile ${job.state.profileId})`,
    );

    const timeout = setTimeout(() => {
      active.timedOut = true;
      void this.#log(
        active,
        `Timed out after ${this.#workspace.settings.limits.renderTimeoutSeconds} s`,
      );
      this.#terminate(active, "timeout");
    }, this.#workspace.settings.limits.renderTimeoutSeconds * 1000);
    timeout.unref();

    let lastPersist = 0;
    createInterface({ input: child.stdout! }).on("line", (line) => {
      let message: WorkerMessage;
      try {
        message = JSON.parse(line) as WorkerMessage;
      } catch {
        void this.#log(active, line);
        return;
      }
      this.#onMessage(active, message);
      if (Date.now() - lastPersist > 500 || message.type !== "progress") {
        lastPersist = Date.now();
        void this.#persist(active);
      }
    });
    createInterface({ input: child.stderr! }).on("line", (line) => void this.#log(active, line));

    child.on("close", (code) => {
      clearTimeout(timeout);
      void this.#complete(active, code).then(resolveFinished);
    });
    child.on(
      "error",
      (error) => void this.#log(active, `Worker failed to start: ${error.message}`),
    );
    return { ...active.state };
  }

  #onMessage(active: Active, message: WorkerMessage): void {
    const state = active.state;
    switch (message.type) {
      case "phase":
        state.phase = message.phase;
        state.progress = Math.max(state.progress, PHASE_BANDS[message.phase][0]);
        void this.#log(active, `Phase: ${message.phase}`);
        break;
      case "progress": {
        const [from, to] = PHASE_BANDS[message.phase];
        state.phase = message.phase;
        state.progress = Math.max(
          state.progress,
          from + (to - from) * Math.min(Math.max(message.progress, 0), 1),
        );
        if (message.renderedFrames !== undefined) state.renderedFrames = message.renderedFrames;
        break;
      }
      case "log":
        void this.#log(active, message.message);
        break;
      case "frame-error":
        void this.#log(active, `Frame ${message.frame} threw: ${message.message}`);
        active.workerError = {
          code: "COMPOSITION_RUNTIME_ERROR",
          message: `The composition threw at frame ${message.frame}: ${firstLine(message.message)}`,
        };
        break;
      case "error":
        void this.#log(active, `Error (${message.code}): ${message.message}`);
        active.workerError ??= { code: message.code, message: firstLine(message.message) };
        break;
      case "done":
        void this.#log(active, "Worker finished rendering");
        break;
    }
  }

  #terminate(active: Active, reason: "cancel" | "timeout"): void {
    if (reason === "cancel") active.cancelRequested = true;
    if (active.child.exitCode !== null || active.child.signalCode !== null) return;
    active.child.kill("SIGTERM");
    setTimeout(() => {
      if (active.child.exitCode === null && active.child.signalCode === null)
        active.child.kill("SIGKILL");
    }, this.#killTimeoutMs).unref();
  }

  async #complete(active: Active, code: number | null): Promise<JobState> {
    const state = active.state;
    delete state.pid;
    try {
      if (active.cancelRequested) {
        state.status = "cancelled";
        state.error = { code: "CANCELLED", message: "Cancelled by the operator" };
      } else if (active.timedOut) {
        state.status = "failed";
        state.error = {
          code: "RENDER_FAILED",
          message: "The render exceeded the configured time limit",
        };
      } else if (code === 0) {
        state.phase = "finalising";
        state.progress = PHASE_BANDS.finalising[0];
        await this.#persist(active);
        state.outputs = await this.#finalise(active);
        state.status = "succeeded";
        state.phase = "done";
        state.progress = 1;
      } else {
        state.status = "failed";
        state.error = active.workerError ?? {
          code: "RENDER_FAILED",
          message: `The render worker exited with code ${code}`,
        };
      }
    } catch (error) {
      state.status = "failed";
      state.error =
        error instanceof MotionStudioError
          ? { code: error.code, message: error.message }
          : {
              code: "RENDER_FAILED",
              message: error instanceof Error ? error.message : String(error),
            };
    }
    state.completedAt = this.#workspace.timestamp();
    // Successful outputs have already been moved out; everything left is scratch.
    await cleanPartials(active.jobDir);
    await this.#log(
      active,
      `Render ${state.status}${state.error ? `: ${state.error.message}` : ""}`,
    );
    await this.#persist(active);
    active.done = true;
    await this.#releaseLock();
    return { ...state };
  }

  /**
   * Validate the worker's output and move it into the production folder.
   * The manifest is written last, so its presence means the render succeeded.
   */
  async #finalise(active: Active): Promise<NonNullable<JobState["outputs"]>> {
    const { request, production, profile, productionDir, preflight } = active;
    const fingerprint = computeFingerprint(
      await gatherFingerprintInputs(this.#workspace, this.#assets, production.id, profile),
    );
    if (fingerprint !== active.state.fingerprint) {
      throw new MotionStudioError(
        "INPUTS_CHANGED",
        "Source, assets, props or settings changed while rendering; the output no longer matches its inputs. Render again.",
      );
    }

    const expectedSize = outputSize(production.format, profile);
    const finalDir = this.#workspace.policy.resolve(productionDir, "renders", "final");
    const manifestsDir = this.#workspace.policy.resolve(productionDir, "renders", "manifests");
    await mkdir(finalDir, { recursive: true });
    await mkdir(manifestsDir, { recursive: true });

    const posterProbe = await probeImage(request.outputs.poster);
    if (
      posterProbe.codec !== "png" ||
      posterProbe.width !== expectedSize.width ||
      posterProbe.height !== expectedSize.height
    ) {
      throw new MotionStudioError(
        "VIDEO_VALIDATION_FAILED",
        `Poster is ${posterProbe.codec} ${posterProbe.width}×${posterProbe.height}, expected png ${expectedSize.width}×${expectedSize.height}`,
      );
    }

    const environment = await renderEnvironment(this.#workspace.repoRoot);
    const relativeToProduction = (file: string) =>
      path.relative(productionDir, file).split(path.sep).join("/");
    const moved: string[] = [];
    try {
      if (request.kind === "render" && request.outputs.video) {
        const probe = await probeVideo(request.outputs.video);
        const problems = videoProblems(
          {
            codec: "h264",
            pixelFormat: "yuv420p",
            ...expectedSize,
            fps: production.format.fps,
            frames: production.format.durationInFrames,
          },
          probe,
        );
        if (problems.length > 0)
          throw new MotionStudioError(
            "VIDEO_VALIDATION_FAILED",
            `Output check failed: ${problems.join("; ")}`,
          );

        const names = outputNames(request.renderId);
        const videoFile = path.join(finalDir, names.video);
        const posterFile = path.join(finalDir, names.poster);
        const videoHash = await hashFile(request.outputs.video);
        const posterHash = await hashFile(request.outputs.poster);
        const { size: videoBytes } = await stat(request.outputs.video);
        await moveNoOverwrite(request.outputs.video, videoFile);
        moved.push(videoFile);
        await moveNoOverwrite(request.outputs.poster, posterFile);
        moved.push(posterFile);

        const manifest = renderManifestSchema.parse({
          schemaVersion: 1,
          renderId: request.renderId,
          productionId: production.id,
          compositionId: production.compositionId,
          profileId: profile.id,
          requestedAt: active.state.requestedAt,
          startedAt: active.state.startedAt,
          completedAt: this.#workspace.timestamp(),
          status: "succeeded",
          inputFingerprint: fingerprint,
          ...(preflight.git ? { git: preflight.git } : {}),
          environment,
          video: {
            relativePath: relativeToProduction(videoFile),
            sha256: videoHash,
            bytes: videoBytes,
            width: probe.width,
            height: probe.height,
            fps: probe.fps,
            durationInFrames: probe.frames,
            durationSeconds: probe.durationSeconds,
            codec: probe.codec,
            pixelFormat: probe.pixelFormat,
          },
          poster: {
            relativePath: relativeToProduction(posterFile),
            frame: request.posterFrame,
            sha256: posterHash,
          },
          warnings: active.state.warnings,
        } satisfies RenderManifest);
        const manifestFile = path.join(manifestsDir, names.manifest);
        await writeExclusive(manifestFile, serializeJson(manifest));
        moved.push(manifestFile);
        return {
          video: toRepoRelative(this.#workspace.repoRoot, videoFile),
          poster: toRepoRelative(this.#workspace.repoRoot, posterFile),
          manifest: toRepoRelative(this.#workspace.repoRoot, manifestFile),
        };
      }

      const names = posterOnlyNames(request.renderId, request.posterFrame);
      const posterFile = path.join(finalDir, names.poster);
      const posterHash = await hashFile(request.outputs.poster);
      const { size: posterBytes } = await stat(request.outputs.poster);
      await moveNoOverwrite(request.outputs.poster, posterFile);
      moved.push(posterFile);
      const manifest = posterManifestSchema.parse({
        schemaVersion: 1,
        renderId: request.renderId,
        productionId: production.id,
        compositionId: production.compositionId,
        profileId: profile.id,
        requestedAt: active.state.requestedAt,
        startedAt: active.state.startedAt,
        completedAt: this.#workspace.timestamp(),
        status: "succeeded",
        inputFingerprint: fingerprint,
        ...(preflight.git ? { git: preflight.git } : {}),
        environment,
        poster: {
          relativePath: relativeToProduction(posterFile),
          frame: request.posterFrame,
          sha256: posterHash,
          bytes: posterBytes,
          width: posterProbe.width,
          height: posterProbe.height,
        },
        warnings: active.state.warnings,
      } satisfies PosterManifest);
      const manifestFile = path.join(manifestsDir, names.manifest);
      await writeExclusive(manifestFile, serializeJson(manifest));
      moved.push(manifestFile);
      return {
        poster: toRepoRelative(this.#workspace.repoRoot, posterFile),
        manifest: toRepoRelative(this.#workspace.repoRoot, manifestFile),
      };
    } catch (error) {
      // Never leave a half-published render behind.
      for (const file of moved) await rm(file, { force: true });
      throw error;
    }
  }

  /** Copy the production's registered assets into the job's public folder and re-verify their hashes. */
  async #stageAssets(productionId: string, publicDir: string): Promise<void> {
    for (const listing of await assetChain(this.#workspace, this.#assets, productionId)) {
      const scopeDir = path.join(publicDir, "assets", listing.scope);
      await mkdir(scopeDir, { recursive: true });
      for (const asset of listing.assets) {
        const source = path.join(this.#workspace.repoRoot, ...asset.path.split("/"));
        const target = path.join(scopeDir, asset.record.storedName);
        await copyFile(source, target, constants.COPYFILE_EXCL | constants.COPYFILE_FICLONE);
        if ((await hashFile(target)) !== asset.record.sha256) {
          throw new MotionStudioError(
            "INPUTS_CHANGED",
            `${asset.path} changed since it was registered`,
          );
        }
      }
    }
  }

  async #uniqueRenderId(base: string): Promise<string> {
    for (let attempt = 1; attempt < 100; attempt++) {
      const candidate = attempt === 1 ? base : `${base}-${attempt}`;
      const exists = await stat(path.join(this.#workspace.jobsRoot, candidate)).then(
        () => true,
        () => false,
      );
      if (!exists) return candidate;
    }
    throw new MotionStudioError("ALREADY_EXISTS", "Could not allocate a render ID");
  }

  async #persist(active: Active): Promise<void> {
    await writeJsonAtomic(path.join(active.jobDir, "job.json"), active.state).catch(
      () => undefined,
    );
  }

  /** Append a redacted line to the bounded in-memory log and the size-capped log file. */
  async #log(active: Active, line: string): Promise<void> {
    const clean = redact(line, this.#workspace.repoRoot);
    const stamped = `${new Date().toISOString().slice(11, 19)} ${clean}`;
    active.log.push(stamped);
    if (active.log.length > LOG_LINES_IN_MEMORY)
      active.log.splice(0, active.log.length - LOG_LINES_IN_MEMORY);
    const file = path.join(active.jobDir, "log.txt");
    const size = await stat(file).then(
      (s) => s.size,
      () => 0,
    );
    if (size < LOG_FILE_LIMIT) await appendFile(file, `${stamped}\n`).catch(() => undefined);
  }

  // ------------------------------------------------------------------ lock

  #lockPath(): string {
    return path.join(this.#workspace.jobsRoot, LOCK_FILE);
  }

  /** Take the machine-wide single-render lock. `update` rewrites our own lock with the real render ID. */
  async #acquireLock(renderId: string, update = false): Promise<void> {
    await mkdir(this.#workspace.jobsRoot, { recursive: true });
    const lock = this.#lockPath();
    if (update) {
      await writeJsonAtomic(lock, { pid: process.pid, renderId });
      return;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const handle = await open(lock, "wx");
        await handle.writeFile(JSON.stringify({ pid: process.pid, renderId }));
        await handle.close();
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const holder = await readLock(lock);
        if (holder && isAlive(holder.pid)) throw busy(holder.renderId);
        await unlink(lock).catch(() => undefined);
      }
    }
    throw busy("unknown");
  }

  async #releaseLock(): Promise<void> {
    const holder = await readLock(this.#lockPath());
    if (holder?.pid === process.pid) await unlink(this.#lockPath()).catch(() => undefined);
  }

  async #releaseStaleLock(): Promise<void> {
    const holder = await readLock(this.#lockPath());
    if (holder && !isAlive(holder.pid)) await unlink(this.#lockPath()).catch(() => undefined);
  }
}

// ------------------------------------------------------------------ helpers

function busy(renderId: string): MotionStudioError {
  return new MotionStudioError(
    "BUSY",
    `Another render is running (${renderId}). Wait for it or cancel it first.`,
  );
}

/** Only what the worker needs. No secrets from the parent environment are passed on. */
function workerEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { TZ: "UTC", LANG: "en_US.UTF-8", NODE_ENV: "production" };
  for (const key of ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "SYSTEMROOT"]) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}

async function readJobState(jobDir: string): Promise<JobState | undefined> {
  try {
    return JSON.parse(await readFile(path.join(jobDir, "job.json"), "utf8")) as JobState;
  } catch {
    return undefined;
  }
}

async function readLock(lock: string): Promise<{ pid: number; renderId: string } | undefined> {
  try {
    return JSON.parse(await readFile(lock, "utf8")) as { pid: number; renderId: string };
  } catch {
    return undefined;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Delete partial outputs, the bundle and staged assets; keep request, state and log for diagnosis. */
async function cleanPartials(jobDir: string): Promise<void> {
  for (const entry of await readdir(jobDir).catch(() => [])) {
    if (entry === "job.json" || entry === "request.json" || entry === "log.txt") continue;
    await rm(path.join(jobDir, entry), { recursive: true, force: true });
  }
}

/** Move without ever overwriting: hard-link then unlink, or exclusive copy across filesystems. */
async function moveNoOverwrite(from: string, to: string): Promise<void> {
  try {
    await link(from, to);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EEXIST")
      throw new MotionStudioError("ALREADY_EXISTS", `${path.basename(to)} already exists`);
    if (code !== "EXDEV") throw error;
    await copyFile(from, to, constants.COPYFILE_EXCL);
  }
  await unlink(from);
}

async function writeExclusive(file: string, content: string): Promise<void> {
  const handle = await open(file, "wx", 0o644);
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function redact(line: string, repoRoot: string): string {
  let result = line.replaceAll(`${repoRoot}/`, "").replaceAll(repoRoot, ".");
  if (process.env.HOME) result = result.replaceAll(process.env.HOME, "~");
  return result;
}

function firstLine(message: string): string {
  return message.split("\n")[0]!.slice(0, 500);
}
