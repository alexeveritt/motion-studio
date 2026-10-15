import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { CLEAN_SVG, makePng } from "../packages/core/test/media-fixtures.ts";
import { goto, workspaceDir } from "./helpers.ts";

test.describe.configure({ mode: "serial" });

const BASE = "/projects/asset-test/campaigns/launch/productions/hero";
let productionId: string;

async function post(request: APIRequestContext, url: string, data: unknown) {
  const response = await request.post(url, { data, headers: { Origin: "http://127.0.0.1:4331" } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as { id: string };
}

test.beforeAll(async ({ request }) => {
  const project = await post(request, "/api/projects", { name: "Asset Test" });
  const campaign = await post(request, `/api/projects/${project.id}/campaigns`, { name: "Launch" });
  const production = await post(request, `/api/campaigns/${campaign.id}/productions`, {
    title: "Hero",
    format: { width: 1080, height: 1920, fps: 30, durationInFrames: 360 },
  });
  productionId = production.id;
});

test("uploads images, shows metadata and a working thumbnail", async ({ page }) => {
  await goto(page, `${BASE}?tab=assets`);
  await page.getByLabel("Upload to Production assets").setInputFiles({
    name: "Phone Screen (v2).png",
    mimeType: "image/png",
    buffer: makePng(300, 600),
  });
  const card = page.locator(".asset-card").filter({ hasText: "phone-screen-v2.png" });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Uploaded as Phone Screen (v2).png");
  await expect(card).toContainText("image/png · 300×600");
  await expect(card.locator(".badge")).toHaveText("ok");
  const thumbnail = card.locator("img");
  await expect
    .poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBe(300);

  const stored = path.join(
    workspaceDir,
    "asset-test/campaigns/launch/productions/hero/assets/phone-screen-v2.png.asset.json",
  );
  expect(JSON.parse(await readFile(stored, "utf8"))).toMatchObject({
    width: 300,
    height: 600,
    mimeType: "image/png",
  });
});

test("rejects disguised, duplicate and unsafe uploads with a clear message", async ({ page }) => {
  await goto(page, `${BASE}?tab=assets`);
  const input = page.getByLabel("Upload to Production assets");

  await input.setInputFiles({
    name: "innocent.png",
    mimeType: "image/png",
    buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]),
  });
  await expect(page.getByRole("alert").filter({ hasText: "Unsupported file type" })).toBeVisible();

  await input.setInputFiles({ name: "copy.png", mimeType: "image/png", buffer: makePng(300, 600) });
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "identical file is already stored as phone-screen-v2.png" }),
  ).toBeVisible();

  await input.setInputFiles({
    name: "logo.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg onload="alert(1)"/>'),
  });
  await expect(
    page.getByRole("alert").filter({ hasText: "SVG rejected for safety" }),
  ).toBeVisible();
});

test("keeps traversal names inside the asset folder", async ({ request }) => {
  const response = await request.post(`/api/assets/production/${productionId}`, {
    data: makePng(8, 8, [1, 2, 3]),
    headers: {
      Origin: "http://127.0.0.1:4331",
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent("../../../../escape.png"),
    },
  });
  expect(response.status()).toBe(201);
  const entry = (await response.json()) as { path: string };
  expect(entry.path).toBe(
    ".motion-studio/tmp/e2e/projects/asset-test/campaigns/launch/productions/hero/assets/escape.png",
  );
});

test("rejects uploads without the octet-stream type or from another origin", async ({
  request,
}) => {
  const wrongType = await request.post(`/api/assets/production/${productionId}`, {
    data: makePng(8, 8),
    headers: {
      Origin: "http://127.0.0.1:4331",
      "Content-Type": "image/png",
      "X-File-Name": "a.png",
    },
  });
  expect(wrongType.status()).toBe(415);
  const crossOrigin = await request.post(`/api/assets/production/${productionId}`, {
    data: makePng(8, 8),
    headers: {
      Origin: "http://evil.example",
      "Content-Type": "application/octet-stream",
      "X-File-Name": "a.png",
    },
  });
  expect(crossOrigin.status()).toBe(403);
});

test("serves SVG assets sandboxed and with the detected type", async ({ request }) => {
  const response = await request.post(`/api/assets/production/${productionId}`, {
    data: Buffer.from(CLEAN_SVG),
    headers: {
      Origin: "http://127.0.0.1:4331",
      "Content-Type": "application/octet-stream",
      "X-File-Name": "wordmark.svg",
    },
  });
  const { record } = (await response.json()) as { record: { id: string } };
  const file = await request.get(`/api/assets/production/${productionId}/${record.id}/file`);
  expect(file.headers()["content-type"]).toBe("image/svg+xml");
  expect(file.headers()["content-security-policy"]).toBe(
    "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  );
  expect(file.headers()["x-content-type-options"]).toBe("nosniff");
});

test("edits asset details and archives an unused asset", async ({ page }) => {
  await goto(page, `${BASE}?tab=assets`);
  const card = page.locator(".asset-card").filter({ hasText: "escape.png" });
  await card.locator("summary", { hasText: "Details" }).click();
  await card.getByLabel("Alt text").fill("Test swatch");
  await card.getByLabel("Licence notes").fill("Generated for tests");
  await card.getByRole("button", { name: "Save details" }).click();
  await expect(card.getByRole("status")).toHaveText("Saved");

  await card.locator("summary", { hasText: "Archive" }).click();
  await card.getByLabel("Type escape.png to confirm").fill("escape.png");
  await card.getByRole("button", { name: "Archive asset" }).click();
  await expect(page.locator(".asset-card").filter({ hasText: "escape.png" })).toHaveCount(0);
});

test("previews the context packet with assets and source inventory", async ({ page }) => {
  await goto(page, `${BASE}?tab=prompt`);
  await page.getByRole("button", { name: "Preview packet" }).click();
  const packet = page.getByLabel("Context packet");
  await expect(packet).toContainText("# Context packet: Hero");
  await expect(packet).toContainText("## Edit boundary");
  await expect(packet).toContainText("productions/hero/assets/phone-screen-v2.png");
  await expect(packet).toContainText("Do not commit, push, or change branches.");
  await expect(packet).not.toContainText("escape.png");
});

test("regenerates the prompt as a candidate and replaces it only on request", async ({ page }) => {
  const promptFile = path.join(
    workspaceDir,
    "asset-test/campaigns/launch/productions/hero/prompt.md",
  );
  await goto(page, `${BASE}?tab=prompt`);
  const editor = page.getByLabel("Claude prompt Markdown", { exact: true });
  await editor.fill("# Hand-written prompt\n");
  await editor.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Regenerate prompt from template" }).click();
  const diff = page.getByLabel("Differences between saved prompt and candidate");
  await expect(diff.locator('[data-op="remove"]')).toHaveText("- # Hand-written prompt\n");
  await expect(diff.locator('[data-op="add"]').first()).toHaveText("+ # Implement Hero\n");
  await expect(page.getByText(/Saved as a candidate at/)).toContainText(
    ".motion-studio/tmp/prompt-candidates/hero-",
  );
  expect(await readFile(promptFile, "utf8")).toBe("# Hand-written prompt\n");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Replace saved prompt" }).click();
  await expect(editor).toHaveValue(/^# Implement Hero/);
  expect(await readFile(promptFile, "utf8")).toMatch(/^# Implement Hero/);
});
