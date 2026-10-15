/**
 * Render worker. Spawned by the render controller with an argument array, no
 * shell and a minimal environment:
 *
 *   node scripts/render-worker.ts <request.json>
 *
 * Writes one JSON message per line to stdout (see WorkerMessage). Renders
 * only into the paths named in the request; the controller validates,
 * hashes and moves the results.
 */
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { RenderRequest, WorkerMessage } from "@motion-studio/core";
import { bundle } from "@remotion/bundler";
import {
  ensureBrowser,
  makeCancelSignal,
  openBrowser,
  renderMedia,
  renderStill,
  selectComposition,
} from "@remotion/renderer";

const send = (message: WorkerMessage) => process.stdout.write(`${JSON.stringify(message)}\n`);

const requestPath = process.argv[2];
if (!requestPath) {
  send({ type: "error", code: "INVALID_INPUT", message: "Usage: render-worker.ts <request.json>" });
  process.exit(2);
}
const request = JSON.parse(await readFile(requestPath, "utf8")) as RenderRequest;

const { cancelSignal, cancel } = makeCancelSignal();
let cancelled = false;
const stop = () => {
  if (cancelled) return;
  cancelled = true;
  cancel();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

// If the controller dies, stop rather than keep rendering for nobody.
const parentPid = process.ppid;
setInterval(() => {
  if (process.ppid !== parentPid) {
    stop();
    setTimeout(() => process.exit(1), 3000).unref();
  }
}, 1000).unref();

let lastSent = 0;
const progress = (message: Extract<WorkerMessage, { type: "progress" }>) => {
  const now = Date.now();
  if (now - lastSent < 250 && message.progress < 1) return;
  lastSent = now;
  send(message);
};

const browser = await (async () => {
  send({ type: "phase", phase: "browser" });
  await ensureBrowser({
    onBrowserDownload: () => {
      send({
        type: "log",
        message: "Downloading Remotion's pinned headless Chrome (first run only)",
      });
      return {
        version: null,
        onProgress: ({ percent }) =>
          progress({ type: "progress", phase: "browser", progress: percent }),
      };
    },
  });
  return openBrowser("chrome", { logLevel: "warn" });
})();

try {
  send({ type: "phase", phase: "bundling" });
  const serveUrl = await bundle({
    entryPoint: request.bundleEntry,
    publicDir: request.publicDir,
    outDir: request.bundleDir,
    rootDir: process.cwd(),
    enableCaching: true,
    onProgress: (percent) =>
      progress({ type: "progress", phase: "bundling", progress: percent / 100 }),
  });

  const common = {
    serveUrl,
    inputProps: request.inputProps,
    puppeteerInstance: browser,
    timeoutInMilliseconds: request.frameTimeoutMs,
    logLevel: "warn" as const,
  };
  const composition = await selectComposition({ ...common, id: request.compositionId });

  // Smoke test: render sample frames small so runtime errors fail fast, before the long render.
  send({ type: "phase", phase: "checking" });
  await mkdir(request.smokeDir, { recursive: true });
  for (const [index, frame] of request.sampleFrames.entries()) {
    try {
      await renderStill({
        ...common,
        composition,
        frame,
        output: path.join(request.smokeDir, `frame-${frame}.jpeg`),
        imageFormat: "jpeg",
        scale: 0.25,
        cancelSignal,
      });
    } catch (error) {
      if (cancelled) throw error;
      send({
        type: "frame-error",
        frame,
        message: error instanceof Error ? error.message : String(error),
      });
      process.exitCode = 3;
      throw error;
    }
    progress({
      type: "progress",
      phase: "checking",
      progress: (index + 1) / request.sampleFrames.length,
    });
  }

  if (request.kind === "render" && request.outputs.video) {
    send({ type: "phase", phase: "rendering" });
    const { overwrite: _overwrite, ...options } = request.options;
    await renderMedia({
      ...common,
      ...options,
      composition,
      outputLocation: request.outputs.video,
      overwrite: false,
      cancelSignal,
      onProgress: ({ progress: value, renderedFrames, encodedFrames }) =>
        progress({
          type: "progress",
          phase: "rendering",
          progress: value,
          renderedFrames,
          encodedFrames,
        }),
    });
  }

  send({ type: "phase", phase: "poster" });
  await renderStill({
    ...common,
    composition,
    frame: request.posterFrame,
    output: request.outputs.poster,
    imageFormat: "png",
    scale: request.options.scale,
    overwrite: false,
    cancelSignal,
  });

  send({ type: "done" });
  await browser.close({ silent: true });
  process.exit(0);
} catch (error) {
  await browser.close({ silent: true }).catch(() => undefined);
  if (cancelled) {
    send({ type: "error", code: "CANCELLED", message: "Render cancelled" });
    process.exit(130);
  }
  const message = error instanceof Error ? error.message : String(error);
  send({
    type: "error",
    code: process.exitCode === 3 ? "COMPOSITION_RUNTIME_ERROR" : "RENDER_FAILED",
    message,
  });
  process.exit(process.exitCode === 3 ? 3 : 1);
}
