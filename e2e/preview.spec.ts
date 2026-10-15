import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { makePng } from "../packages/core/test/media-fixtures.ts";
import { goto, productionDir } from "./helpers.ts";

test.describe.configure({ mode: "serial" });

const ORIGIN = { Origin: "http://127.0.0.1:4331" };
const URL_BASE = "/projects/preview-test/campaigns/spots/productions/advert";
const DIR = productionDir("preview-test", "spots", "advert");
const ENTRY = path.join(DIR, "src/composition.tsx");
let compositionId: string;
let projectId: string;

async function post(request: APIRequestContext, url: string, data: unknown) {
  const response = await request.post(url, { data, headers: ORIGIN });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as { id: string; compositionId: string };
}

/** Write a source file, then give the dev server's watcher a moment to invalidate it. */
async function writeSource(file: string, source: string) {
  await writeFile(file, source);
  await new Promise((resolve) => setTimeout(resolve, 400));
}

const stage = (page: Page) => page.locator(".preview-frame");
const frameInput = (page: Page) => page.getByLabel("Frame", { exact: true });

async function openPreview(page: Page, query = "") {
  await goto(page, `${URL_BASE}?tab=preview${query}`);
}

async function enterFrame(page: Page, frame: number) {
  await frameInput(page).fill(String(frame));
  await frameInput(page).press("Enter");
}

async function expectFrame(page: Page, frame: number) {
  await expect(stage(page)).toContainText(`frame ${frame} of 359`);
  await expect(frameInput(page)).toHaveValue(String(frame));
}

test.beforeAll(async ({ request }) => {
  const project = await post(request, "/api/projects", { name: "Preview Test" });
  projectId = project.id;
  const campaign = await post(request, `/api/projects/${project.id}/campaigns`, { name: "Spots" });
  const production = await post(request, `/api/campaigns/${campaign.id}/productions`, {
    title: "Advert",
    format: { width: 1080, height: 1920, fps: 30, durationInFrames: 360 },
    posterFrame: 300,
  });
  compositionId = production.compositionId;
});

test("previews a new production without manual wiring", async ({ page }) => {
  await openPreview(page);
  await expect(stage(page)).toContainText("Advert");
  await expectFrame(page, 0);
  await expect(page.getByLabel("Timecode")).toHaveText("00:00:00:00");
  await expect(page.locator(".preview-options")).toContainText("1080×1920 · 30 fps · 360 frames");
});

test("scrubs to exact frames and clamps out-of-range entries", async ({ page }) => {
  await openPreview(page);
  for (const [frame, timecode] of [
    [60, "00:00:02:00"],
    [180, "00:00:06:00"],
    [270, "00:00:09:00"],
    [359, "00:00:11:29"],
  ] as const) {
    await enterFrame(page, frame);
    await expectFrame(page, frame);
    await expect(page.getByLabel("Timecode")).toHaveText(timecode);
    await expect(page.getByLabel("Scrubber")).toHaveValue(String(frame));
  }
  await enterFrame(page, 360);
  await expectFrame(page, 359);

  await page.getByLabel("Scrubber").fill("42");
  await expectFrame(page, 42);
  await page.getByRole("button", { name: "Poster frame (300)" }).click();
  await expectFrame(page, 300);
});

test("steps exactly one frame with buttons and the keyboard", async ({ page }) => {
  await openPreview(page);
  await enterFrame(page, 100);
  await page.getByRole("button", { name: "Next frame" }).click();
  await expectFrame(page, 101);
  await page.getByRole("button", { name: "Previous frame" }).click();
  await expectFrame(page, 100);

  await page.locator(".preview-stage").focus();
  await page.keyboard.press("ArrowRight");
  await expectFrame(page, 101);
  await page.keyboard.press("Shift+ArrowRight");
  await expectFrame(page, 131);
  await page.keyboard.press("ArrowLeft");
  await expectFrame(page, 130);
  await page.keyboard.press("End");
  await expectFrame(page, 359);
  await page.keyboard.press("ArrowRight");
  await expectFrame(page, 359);
  await page.keyboard.press("Home");
  await expectFrame(page, 0);
  await page.keyboard.press("ArrowLeft");
  await expectFrame(page, 0);
});

test("plays and pauses", async ({ page }) => {
  await openPreview(page);
  await page.getByRole("button", { name: "Play" }).click();
  await expect.poll(async () => Number(await frameInput(page).inputValue())).toBeGreaterThan(5);
  await page.getByRole("button", { name: "Pause" }).click();
  const paused = await frameInput(page).inputValue();
  await page.waitForTimeout(300);
  await expect(frameInput(page)).toHaveValue(paused);
});

test("keeps the paused frame across a reload", async ({ page }) => {
  await openPreview(page);
  await enterFrame(page, 200);
  await expect(page).toHaveURL(/frame=200/);
  await page.reload();
  await expectFrame(page, 200);
});

test("uses production props and resolves assets like the renderer will", async ({
  page,
  request,
}) => {
  const upload = await request.post(`/api/assets/brand/${projectId}`, {
    data: makePng(40, 20, [0, 128, 255]),
    headers: { ...ORIGIN, "Content-Type": "application/octet-stream", "X-File-Name": "swatch.png" },
  });
  expect(upload.status()).toBe(201);
  await writeFile(path.join(DIR, "props.json"), JSON.stringify({ headline: "From props" }));
  await writeSource(
    ENTRY,
    `import { useAsset, type MotionStudioComposition } from "@motion-studio/motion-runtime";
import { AbsoluteFill, Img, useCurrentFrame } from "remotion";

type Props = { headline: string };

function Advert({ headline }: Props) {
  const frame = useCurrentFrame();
  const swatch = useAsset("brand:swatch.png");
  return (
    <AbsoluteFill style={{ background: "white", fontSize: 60 }}>
      <Img src={swatch} alt="swatch" />
      <div>{headline} frame {frame} of 359</div>
    </AbsoluteFill>
  );
}

export const composition: MotionStudioComposition<Props> = {
  id: ${JSON.stringify(compositionId)},
  Component: Advert,
  defaultProps: { headline: "Default headline" },
};
`,
  );
  await openPreview(page);
  await expect(stage(page)).toContainText("From props frame 0 of 359");
  const image = stage(page).getByAltText("swatch");
  await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(40);
});

test("shows runtime errors in an overlay without losing navigation", async ({ page }) => {
  await writeSource(
    ENTRY,
    `import type { MotionStudioComposition } from "@motion-studio/motion-runtime";
import { useCurrentFrame } from "remotion";

function Fragile() {
  const frame = useCurrentFrame();
  if (frame >= 100) throw new Error("Scene two is not finished");
  return <div style={{ fontSize: 60 }}>frame {frame} of 359</div>;
}

export const composition: MotionStudioComposition = { id: ${JSON.stringify(compositionId)}, Component: Fragile, defaultProps: {} };
`,
  );
  await openPreview(page);
  await expectFrame(page, 0);
  await enterFrame(page, 100);
  await expect(
    page.getByRole("alert").filter({ hasText: "The composition threw an error" }),
  ).toContainText("Scene two is not finished");
  await page.getByRole("link", { name: "Brief" }).click();
  await expect(page).toHaveURL(/tab=brief/);
});

test("explains compile errors with file and line", async ({ page }) => {
  await writeSource(ENTRY, `export const composition = {\n  id: "x",\n  Component: (\n`);
  await openPreview(page);
  await expect(page.getByRole("alert").filter({ hasText: "could not be loaded" })).toBeVisible();
  await expect(page.getByLabel("Source diagnostics")).toContainText(
    "productions/advert/src/composition.tsx:",
  );
  await page.getByRole("link", { name: "Overview" }).click();
  await expect(page.getByRole("heading", { name: "Details" })).toBeVisible();
});

test("rejects an entry whose id does not match production.json", async ({ page }) => {
  await writeSource(
    ENTRY,
    `export const composition = { id: "someone-else", Component: () => null, defaultProps: {} };\n`,
  );
  await openPreview(page);
  await expect(page.getByRole("alert")).toContainText(
    `but production.json expects "${compositionId}"`,
  );
});

test("offers a placeholder when the entry file is missing", async ({ page }) => {
  await rm(ENTRY);
  await rm(path.join(DIR, "props.json"));
  await openPreview(page);
  await expect(page.getByRole("heading", { name: "No composition yet" })).toBeVisible();
  await page.getByRole("button", { name: "Create placeholder composition" }).click();
  await expect(stage(page)).toContainText("frame 0 of 359", { timeout: 15_000 });
});
