import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { goto, productionDir } from "./helpers.ts";

test.describe.configure({ mode: "serial" });
// Real renders: bundling and encoding take a while.
test.setTimeout(240_000);

const ORIGIN = { Origin: "http://127.0.0.1:4331" };
const CLIP_URL = "/projects/render-test/campaigns/output/productions/clip";
const LONG_URL = "/projects/render-test/campaigns/output/productions/long";
let clipId: string;

async function post(request: APIRequestContext, url: string, data: unknown) {
  const response = await request.post(url, { data, headers: ORIGIN });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as { id: string };
}

test.beforeAll(async ({ request }) => {
  const project = await post(request, "/api/projects", { name: "Render Test" });
  const campaign = await post(request, `/api/projects/${project.id}/campaigns`, { name: "Output" });
  const clip = await post(request, `/api/campaigns/${campaign.id}/productions`, {
    title: "Clip",
    format: { width: 240, height: 320, fps: 30, durationInFrames: 30 },
    posterFrame: 20,
  });
  clipId = clip.id;
  await post(request, `/api/campaigns/${campaign.id}/productions`, {
    title: "Long",
    format: { width: 720, height: 1280, fps: 30, durationInFrames: 1800 },
  });
});

test("runs preflight and shows each check", async ({ page }) => {
  await goto(page, `${CLIP_URL}?tab=render`);
  await page.getByRole("button", { name: "Run preflight" }).click();
  const checks = page.getByLabel("Preflight checks");
  await expect(page.getByText("ready to render")).toBeVisible({ timeout: 60_000 });
  for (const label of [
    "Project, campaign and production records",
    "Composition source type-checks",
    "Assets present, unchanged and readable",
    "Poster frame in range",
    "Rendering tools match pinned versions",
    "Input fingerprint",
  ]) {
    await expect(checks).toContainText(label);
  }
});

test("renders through the UI, follows progress and shows the output", async ({ page }) => {
  await goto(page, `${CLIP_URL}?tab=render`);
  await page.getByRole("button", { name: "Render MP4 and poster" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Running preflight checks" }),
  ).toBeVisible();
  await expect(page.getByLabel("Render progress")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("status").filter({ hasText: "Render complete" })).toBeVisible({
    timeout: 200_000,
  });

  const output = page.locator(".output-item").first();
  await expect(output).toContainText("240×320 · 30 fps · 30 frames (1.00 s) · h264/yuv420p");
  await expect(output).toContainText("Poster frame 20 (00:00:00:20)");
  const video = output.locator("video");
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState >= 1 && v.duration), {
      timeout: 15_000,
    })
    .toBeCloseTo(1, 1);

  const manifests = await readdir(
    path.join(productionDir("render-test", "output", "clip"), "renders/manifests"),
  );
  const manifest = JSON.parse(
    await readFile(
      path.join(
        productionDir("render-test", "output", "clip"),
        "renders/manifests",
        manifests.find((m) => m.endsWith(".render.json"))!,
      ),
      "utf8",
    ),
  );
  expect(manifest).toMatchObject({
    status: "succeeded",
    profileId: "standard",
    video: { durationInFrames: 30 },
  });
});

test("serves outputs with byte ranges and refuses files outside the manifests", async ({
  request,
}) => {
  const history = (await (await request.get(`/api/productions/${clipId}/renders`)).json()) as {
    outputs: { manifest: { video: { relativePath: string; bytes: number } } }[];
  };
  const video = history.outputs[0]!.manifest.video;
  const name = video.relativePath.split("/").pop()!;
  const ranged = await request.get(`/api/productions/${clipId}/outputs/${name}`, {
    headers: { Range: "bytes=0-99" },
  });
  expect(ranged.status()).toBe(206);
  expect(ranged.headers()["content-range"]).toBe(`bytes 0-99/${video.bytes}`);
  expect((await ranged.body()).length).toBe(100);

  for (const bad of ["..%2Fproduction.json", "production.json", "nope.mp4"]) {
    expect((await request.get(`/api/productions/${clipId}/outputs/${bad}`)).status()).toBe(404);
  }
});

test("approves a render, flags input changes and withdraws the approval", async ({
  page,
  request,
}) => {
  const clipDir = productionDir("render-test", "output", "clip");
  const approvedFile = path.join(clipDir, "renders/approved.json");
  await goto(page, `${CLIP_URL}?tab=render`);
  const summary = page.getByLabel("Approved render");
  await expect(summary).toContainText("No render is approved yet");

  const output = page.locator(".output-item").first();
  await output.getByRole("button", { name: "Approve as final" }).click();
  await output.getByLabel("Approval note (optional)").fill("Approved for the e2e channel");
  await output.getByRole("button", { name: "Confirm approval" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Render approved" })).toBeVisible();
  await expect(output).toContainText("Approved final");
  await expect(output.getByRole("button", { name: "Approve as final" })).toHaveCount(0);
  await expect(summary).toContainText("approved");
  await expect(summary).toContainText("Approved for the e2e channel");

  const approval = JSON.parse(await readFile(approvedFile, "utf8")) as {
    renderId: string;
    video: { relativePath: string };
  };
  const manifests = await readdir(path.join(clipDir, "renders/manifests"));
  expect(manifests).toContain(`${approval.renderId}.render.json`);
  expect(approval.video.relativePath).toBe(`renders/final/${approval.renderId}.mp4`);

  // A stale hash is refused.
  const stale = await request.put(`/api/productions/${clipId}/approval`, {
    data: { renderId: approval.renderId, baseHash: "0".repeat(64) },
    headers: ORIGIN,
  });
  expect(stale.status()).toBe(409);

  // Changing the source after approval marks it outdated; restoring clears it.
  const entry = path.join(clipDir, "src/composition.tsx");
  const original = await readFile(entry, "utf8");
  try {
    await writeFile(entry, `${original}\n// changed after approval\n`);
    await page.reload();
    await expect(summary).toContainText("approved, inputs changed since");
    await expect(summary).toContainText("Render again and approve the new render");
  } finally {
    await writeFile(entry, original);
  }
  await page.reload();
  await expect(summary.locator(".badge")).toHaveText("approved");

  await summary.getByRole("button", { name: "Withdraw approval" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Approval withdrawn" })).toBeVisible();
  await expect(summary).toContainText("No render is approved yet");
  await expect(readFile(approvedFile)).rejects.toThrow();
  expect(manifests.length).toBeGreaterThan(0);
  expect(await readdir(path.join(clipDir, "renders/final"))).toContain(`${approval.renderId}.mp4`);
});

test("archives every output except the approved render, then the render itself", async ({
  page,
  request,
}) => {
  // A poster-only render gives the clip a second output.
  const poster = await request.post(`/api/productions/${clipId}/poster`, {
    data: { profileId: "standard", frame: 5 },
    headers: ORIGIN,
  });
  expect(poster.status(), await poster.text()).toBe(202);
  const { renderId: posterId } = (await poster.json()) as { renderId: string };
  await expect
    .poll(
      async () =>
        (
          (await (await request.get(`/api/renders/${posterId}`)).json()) as {
            state: { status: string };
          }
        ).state.status,
      { timeout: 120_000 },
    )
    .toBe("succeeded");

  await goto(page, `${CLIP_URL}?tab=render`);
  const outputs = page.locator(".output-item");
  await expect(outputs).toHaveCount(2);
  const video = outputs.filter({ has: page.locator("video") });
  await video.getByRole("button", { name: "Approve as final" }).click();
  await video.getByRole("button", { name: "Confirm approval" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Render approved" })).toBeVisible();
  await expect(video.getByRole("button", { name: "Move to archive" })).toHaveCount(0);

  // The approved render cannot be archived, even through the API.
  const approval = JSON.parse(
    await readFile(
      path.join(productionDir("render-test", "output", "clip"), "renders/approved.json"),
      "utf8",
    ),
  ) as { renderId: string };
  const refused = await request.post(`/api/productions/${clipId}/renders/archive`, {
    data: { renderIds: [approval.renderId] },
    headers: ORIGIN,
  });
  expect(refused.status()).toBe(409);

  await page.getByRole("button", { name: "Archive the other 1 output…" }).click();
  await expect(page.getByText("Moves every render except the approved one")).toBeVisible();
  await page.getByRole("button", { name: "Move 1 to archive" }).click();
  const moved = page.getByRole("status").filter({ hasText: "Moved 1 render to" });
  await expect(moved).toBeVisible();
  await expect(outputs).toHaveCount(1);
  const archivedPath = (await moved.textContent())!.replace(/^Moved 1 render to /, "").trim();
  const archive = JSON.parse(
    await readFile(path.join(process.cwd(), archivedPath, "archive.json"), "utf8"),
  ) as { renderIds: string[]; files: string[] };
  expect(archive.renderIds).toEqual([posterId]);
  expect(archive.files).toEqual([
    `renders/manifests/${posterId}-poster-f5.poster.json`,
    `renders/final/${posterId}-poster-f5.png`,
  ]);

  // Withdraw the approval, then archive the video itself.
  await page.getByRole("button", { name: "Withdraw approval" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Approval withdrawn" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Archive the other/ })).toHaveCount(0);
  await outputs.first().getByRole("button", { name: "Move to archive" }).click();
  await outputs.first().getByRole("button", { name: "Confirm move to archive" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Moved 1 render to" })).toBeVisible();
  await expect(page.getByText("No successful renders yet")).toBeVisible();
  const clipDir = productionDir("render-test", "output", "clip");
  for (const folder of ["renders/final", "renders/manifests"]) {
    expect((await readdir(path.join(clipDir, folder))).filter((f) => !f.startsWith("."))).toEqual(
      [],
    );
  }
});

test("cancels a long render and rejects a second render meanwhile", async ({ page, request }) => {
  await goto(page, `${LONG_URL}?tab=render`);
  await page.getByRole("button", { name: "Render MP4 and poster" }).click();
  await expect(page.getByText(/\d+\/1800 frames/)).toBeVisible({ timeout: 180_000 });

  const second = await request.post(`/api/productions/${clipId}/renders`, {
    data: { profileId: "standard" },
    headers: ORIGIN,
  });
  expect(second.status()).toBe(409);
  expect(((await second.json()) as { error: { code: string } }).error.code).toBe("BUSY");

  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Cancelled" })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText("Unsuccessful jobs")).toBeVisible();
  const longDir = productionDir("render-test", "output", "long");
  expect(
    (await readdir(path.join(longDir, "renders/final"))).filter((f) => !f.startsWith(".")),
  ).toEqual([]);
  expect(
    (await readdir(path.join(longDir, "renders/manifests"))).filter((f) => !f.startsWith(".")),
  ).toEqual([]);
});
