/**
 * CookGuide acceptance test (spec sections 17.4 and 17.5), automated.
 *
 *   pnpm acceptance [-- --production <id>]
 *
 * Renders the CookGuide QR advert twice through the same controller the
 * studio uses, verifies the outputs, decodes the QR code, compares golden
 * frames and exercises the failure cases. Temporary changes (an extra asset,
 * emptied props) are restored before exiting. Steps 1, 2, 4 and 5 (install,
 * loopback binding, preview scrubbing and stepping) are covered by the
 * browser tests and the operator checklist in docs/operator-guide.md.
 */
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  compareImages,
  computeFingerprint,
  gatherFingerprintInputs,
  hashFile,
  MotionStudioError,
  probeImage,
  RenderController,
  renderManifestSchema,
  runGolden,
  sha256,
  type JobState,
  type ProductionRecord,
} from "@motion-studio/core";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { openWorkspace, parseCliArgs, runCli } from "./lib/cli.ts";

type Result = { id: string; title: string; ok: boolean; detail: string };

await runCli(async () => {
  const { values } = parseCliArgs({
    production: { type: "string" },
    workspace: { type: "string" },
  });
  const { workspace, assets } = await openWorkspace(values.workspace);
  const controller = new RenderController(workspace, assets);
  await controller.recover();
  const results: Result[] = [];
  const record = (id: string, title: string, ok: boolean, detail: string) => {
    results.push({ id, title, ok, detail });
    console.error(
      `${ok ? "PASS" : "FAIL"}  ${id.padEnd(6)} ${title}${detail ? `\n        ${detail}` : ""}`,
    );
  };
  const step = async (id: string, title: string, run: () => Promise<string>) => {
    try {
      record(id, title, true, await run());
    } catch (error) {
      record(id, title, false, error instanceof Error ? error.message : String(error));
    }
  };
  const expect = (condition: unknown, message: string) => {
    if (!condition) throw new Error(message);
  };

  // Locate the production.
  const catalog = await workspace.scan();
  const entry = catalog.projects
    .flatMap((p) =>
      p.campaigns.flatMap((c) =>
        c.productions.map((production) => ({ project: p, campaign: c, production })),
      ),
    )
    .find(({ production }) =>
      values.production
        ? production.record.id === values.production
        : production.path.endsWith("cookguide/campaigns/qr-awareness/productions/qr-code-advert"),
    );
  if (!entry)
    throw new MotionStudioError(
      "NOT_FOUND",
      "CookGuide production not found; pass --production <id>",
    );
  const production: ProductionRecord = entry.production.record;
  const productionDir = path.join(workspace.repoRoot, ...entry.production.path.split("/"));
  const props = await workspace.readProductionProps(production.id);
  const qrUrl = String(props.props.qrUrl ?? "");
  const profile = workspace.settings.renderProfiles.find((p) => p.id === "standard")!;
  const fingerprintNow = async () =>
    computeFingerprint(await gatherFingerprintInputs(workspace, assets, production.id, profile));
  console.error(
    `Acceptance: ${production.title} (${entry.production.path})\nQR destination: ${qrUrl}\n`,
  );

  const renderAndWait = async (): Promise<JobState> => {
    const job = await controller.start({ productionId: production.id, profileId: "standard" });
    return controller.wait(job.renderId);
  };
  const decode = async (file: string) => {
    const png = PNG.sync.read(await readFile(file));
    return jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data;
  };

  await step("17.4.3", "Schemas and assets validate", async () => {
    const issues = [...catalog.issues, ...(await assets.validate(catalog))].filter((issue) =>
      issue.path.startsWith(entry.project.path),
    );
    expect(issues.length === 0, issues.map((i) => `${i.path}: ${i.message}`).join("; "));
    return "No issues in the CookGuide project";
  });

  await step("17.4.6", "Preflight with the standard profile has no errors", async () => {
    const result = await controller.preflight(production.id, "standard");
    const failures = result.checks.filter((c) => c.status === "fail");
    expect(
      failures.length === 0,
      failures.map((c) => `${c.label}: ${c.messages.join(", ")}`).join("; "),
    );
    return `Fingerprint ${result.fingerprint}; warnings: ${
      result.checks
        .filter((c) => c.status === "warn")
        .map((c) => c.label)
        .join(", ") || "none"
    }`;
  });

  console.error("\nRendering (1 of 2)…");
  const first = await renderAndWait();
  await step("17.4.7", "Render MP4 and poster", async () => {
    expect(first.status === "succeeded", `${first.status}: ${first.error?.message}`);
    return `${first.outputs?.video}`;
  });
  if (first.status !== "succeeded") return summarise(results);

  const manifestFile = path.join(workspace.repoRoot, ...first.outputs!.manifest!.split("/"));
  const manifest = renderManifestSchema.parse(JSON.parse(await readFile(manifestFile, "utf8")));
  const videoFile = path.join(productionDir, manifest.video.relativePath);
  const posterFile = path.join(productionDir, manifest.poster!.relativePath);

  await step("17.4.8", "MP4 is 1080×1920, 30 fps, ~12 s, H.264, yuv420p", async () => {
    const v = manifest.video;
    expect(v.width === 1080 && v.height === 1920, `size ${v.width}×${v.height}`);
    expect(v.fps === 30, `fps ${v.fps}`);
    expect(Math.abs(v.durationSeconds - 12) < 0.05, `duration ${v.durationSeconds}`);
    expect(v.codec === "h264" && v.pixelFormat === "yuv420p", `${v.codec}/${v.pixelFormat}`);
    return `${v.width}×${v.height} ${v.fps} fps ${v.durationSeconds} s ${v.codec}/${v.pixelFormat}`;
  });

  console.error("\nRendering golden frames…");
  const golden = await runGolden(workspace, controller, production.id);
  const fresh = (frame: number) => {
    const found = golden.frames.find((f) => f.frame === frame)?.actual;
    if (!found)
      throw new Error(`Golden frame ${frame} was not rendered; add it to tests/golden.json`);
    return path.join(workspace.repoRoot, ...found.split("/"));
  };

  await step("17.4.9", "Exactly 360 frames, and the final frame is not blank", async () => {
    expect(
      production.format.durationInFrames === 360,
      `configured ${production.format.durationInFrames}`,
    );
    expect(
      manifest.video.durationInFrames === 360,
      `encoded ${manifest.video.durationInFrames} frames`,
    );
    const last = PNG.sync.read(await readFile(fresh(359)));
    const values = new Set<number>();
    for (let i = 0; i < last.data.length; i += 4 * 97)
      values.add(last.data[i]! * 65536 + last.data[i + 1]! * 256 + last.data[i + 2]!);
    expect(values.size > 20, "frame 359 looks blank");
    return `Configured 360, encoded 360, frame 359 has ${values.size}+ distinct sampled colours`;
  });

  await step("17.4.10", "Poster is 1080×1920 and shows frame 300", async () => {
    const image = await probeImage(posterFile);
    expect(image.width === 1080 && image.height === 1920, `poster ${image.width}×${image.height}`);
    expect(manifest.poster?.frame === 300, `manifest poster frame ${manifest.poster?.frame}`);
    const comparison = compareImages(
      PNG.sync.read(await readFile(posterFile)),
      PNG.sync.read(await readFile(fresh(300))),
      golden.tolerance,
    );
    expect(
      comparison.pass,
      `poster differs from a fresh render of frame 300 (${(comparison.differentRatio * 100).toFixed(3)}%)`,
    );
    return `1080×1920, frame 300, matches a fresh frame-300 still (${comparison.differentPixels} px differ)`;
  });

  await step(
    "17.4.11",
    "QR decodes to the configured URL from the poster and a paused frame",
    async () => {
      const fromPoster = await decode(posterFile);
      const fromFrame = await decode(fresh(330));
      expect(fromPoster === qrUrl, `poster decoded "${fromPoster}"`);
      expect(fromFrame === qrUrl, `frame 330 decoded "${fromFrame}"`);
      return `Both decode to ${qrUrl}`;
    },
  );

  await step("17.4.12", "Output, poster and manifest hashes exist and match", async () => {
    expect((await hashFile(videoFile)) === manifest.video.sha256, "video hash mismatch");
    expect((await hashFile(posterFile)) === manifest.poster!.sha256, "poster hash mismatch");
    return `video ${manifest.video.sha256.slice(0, 16)}…, poster ${manifest.poster!.sha256.slice(0, 16)}…, manifest ${sha256(await readFile(manifestFile, "utf8")).slice(0, 16)}…`;
  });

  await step(
    "17.4.13",
    "Manifest records profile, fingerprint, versions and Git state",
    async () => {
      expect(manifest.profileId === "standard", "profile");
      expect(/^[a-f0-9]{64}$/.test(manifest.inputFingerprint), "fingerprint");
      expect(
        manifest.environment.remotion && manifest.environment.node && manifest.environment.pnpm,
        "versions",
      );
      expect(typeof manifest.git?.dirty === "boolean", "git dirty state");
      return `standard, ${manifest.inputFingerprint.slice(0, 12)}…, Remotion ${manifest.environment.remotion}, Node ${manifest.environment.node}, pnpm ${manifest.environment.pnpm}, git ${manifest.git?.commit?.slice(0, 10) ?? "none"} dirty=${manifest.git?.dirty}`;
    },
  );

  await step("17.5.2", "Poster frame 360 is rejected", async () => {
    const { revision, title, description, status, format, defaultRenderProfileId, tags } = (
      await workspace.locate("production", production.id)
    ).record as ProductionRecord;
    try {
      await workspace.updateProduction(production.id, {
        revision,
        title,
        description,
        status,
        format,
        posterFrame: 360,
        defaultRenderProfileId,
        tags,
      });
    } catch (error) {
      expect(error instanceof MotionStudioError && error.code === "INVALID_INPUT", String(error));
      return (error as Error).message;
    }
    throw new Error("posterFrame 360 was accepted");
  });

  await step(
    "17.4.15",
    "Changing a referenced asset changes the fingerprint; the old render stays intact",
    async () => {
      const before = await fingerprintNow();
      const extra = await assets.upload("campaign", entry.campaign.record.id, {
        originalName: "acceptance-temporary.png",
        body: (async function* () {
          const png = new PNG({ width: 4, height: 4 });
          png.data.fill(200);
          yield PNG.sync.write(png);
        })(),
      });
      const changed = await fingerprintNow();
      const { archivedPath } = await assets.archive(
        "campaign",
        entry.campaign.record.id,
        extra.record.id,
        { confirmName: extra.record.storedName },
      );
      await rm(path.join(workspace.repoRoot, archivedPath), { recursive: true });
      const restored = await fingerprintNow();
      expect(changed !== before, "fingerprint did not change");
      expect(restored === before, "fingerprint did not return after removing the asset");
      expect((await hashFile(videoFile)) === manifest.video.sha256, "earlier render changed");
      return `${before.slice(0, 12)}… → ${changed.slice(0, 12)}… → ${restored.slice(0, 12)}…; earlier MP4 unchanged`;
    },
  );

  await step("17.5.3", "A traversal file name cannot escape the asset folder", async () => {
    const entryUpload = await assets.upload("campaign", entry.campaign.record.id, {
      originalName: "../../../../escape.png",
      body: (async function* () {
        const png = new PNG({ width: 2, height: 2 });
        png.data.fill(90);
        yield PNG.sync.write(png);
      })(),
    });
    const { archivedPath } = await assets.archive(
      "campaign",
      entry.campaign.record.id,
      entryUpload.record.id,
      { confirmName: entryUpload.record.storedName },
    );
    await rm(path.join(workspace.repoRoot, archivedPath), { recursive: true });
    expect(entryUpload.path === `${entry.campaign.path}/assets/escape.png`, entryUpload.path);
    return `Stored as ${entryUpload.path}`;
  });

  await step(
    "17.5.1",
    "A missing QR destination blocks the render with a useful error",
    async () => {
      const original = await workspace.readDocument("production", production.id, "props");
      const before = (await controller.history(production.id)).outputs.length;
      const emptied = await workspace.saveDocument("production", production.id, "props", {
        content: "{}\n",
        baseHash: original.hash,
      });
      try {
        const state = await renderAndWait();
        expect(state.status === "failed", `status ${state.status}`);
        expect(
          state.error?.message.includes("props.qrUrl is missing"),
          state.error?.message ?? "no error message",
        );
        expect(
          (await controller.history(production.id)).outputs.length === before,
          "an output was produced",
        );
        return `${state.error?.code}: ${state.error?.message}`;
      } finally {
        await workspace.saveDocument("production", production.id, "props", {
          content: original.content,
          baseHash: emptied.hash,
        });
      }
    },
  );

  await step("17.5.5", "Cancelling removes the partial MP4 and creates no manifest", async () => {
    const before = (await controller.history(production.id)).outputs.length;
    const job = await controller.start({ productionId: production.id, profileId: "standard" });
    const started = Date.now();
    while (((await controller.get(job.renderId)).state.renderedFrames ?? 0) < 1) {
      if (Date.now() - started > 180_000) throw new Error("render never started producing frames");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await controller.cancel(job.renderId);
    const state = await controller.wait(job.renderId);
    const leftovers = await readdir(path.join(workspace.jobsRoot, job.renderId));
    expect(state.status === "cancelled", state.status);
    expect(
      (await controller.history(production.id)).outputs.length === before,
      "a manifest was created",
    );
    expect(
      leftovers.sort().join(",") === "job.json,log.txt,request.json",
      `job folder holds ${leftovers.join(", ")}`,
    );
    return `Cancelled after ${state.renderedFrames} frames; job folder keeps only diagnostics`;
  });

  console.error("\nRendering (2 of 2)…");
  const second = await controller.start({ productionId: production.id, profileId: "standard" });
  await step(
    "17.5.4",
    "A second simultaneous render is refused and cannot corrupt the first",
    async () => {
      try {
        await controller.start({ productionId: production.id, profileId: "draft" });
      } catch (error) {
        expect(error instanceof MotionStudioError && error.code === "BUSY", String(error));
        return (error as Error).message;
      }
      throw new Error("second render was accepted");
    },
  );
  const secondState = await controller.wait(second.renderId);
  await step("17.4.14", "Re-render: same fingerprint, golden frames match", async () => {
    expect(
      secondState.status === "succeeded",
      `${secondState.status}: ${secondState.error?.message}`,
    );
    expect(
      secondState.fingerprint === first.fingerprint,
      `${secondState.fingerprint} ≠ ${first.fingerprint}`,
    );
    const failing = golden.frames.filter((frame) => frame.status !== "pass");
    expect(
      failing.length === 0,
      failing.map((f) => `frame ${f.frame} ${f.status}${f.diff ? ` (${f.diff})` : ""}`).join("; "),
    );
    return `Fingerprint ${secondState.fingerprint.slice(0, 12)}… unchanged; ${golden.frames.length} golden frames within tolerance`;
  });

  return summarise(results);
});

function summarise(results: Result[]): number {
  const failed = results.filter((r) => !r.ok);
  console.error(`\n${results.length - failed.length}/${results.length} acceptance checks passed`);
  console.log(JSON.stringify(results, null, 2));
  return failed.length === 0 ? 0 : 1;
}
