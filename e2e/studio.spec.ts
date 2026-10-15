import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { goto, hydrated, productionDir, workspaceDir } from "./helpers.ts";

const PRODUCTION_URL =
  "/projects/cookguide/campaigns/qr-awareness/productions/cookguide-qr-code-advert";

test.describe.configure({ mode: "serial" });

test("creates a project, campaign and production using only the UI", async ({ page }) => {
  await goto(page, "/");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

  await page.getByRole("link", { name: "New project" }).click();
  await page.waitForURL(/projects\/new$/);
  await hydrated(page);
  await page.getByLabel("Name", { exact: true }).fill("CookGuide");
  await expect(page.getByLabel("Folder name", { exact: true })).toHaveAttribute(
    "placeholder",
    "cookguide",
  );
  await page.getByLabel("Description", { exact: true }).fill("Step-by-step recipe guidance");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL("/projects/cookguide");
  await expect(page.getByRole("heading", { level: 1, name: "CookGuide" })).toBeVisible();

  await page.getByRole("link", { name: "New campaign" }).click();
  await page.waitForURL(/campaigns\/new$/);
  await hydrated(page);
  await page.getByLabel("Name", { exact: true }).fill("QR Awareness");
  await page.getByLabel("Objective", { exact: true }).fill("Drive scans of the CookGuide QR code");
  await page.getByLabel("Audience", { exact: true }).fill("Home cooks\nBusy parents");
  await page.getByRole("button", { name: "Create campaign" }).click();
  await expect(page).toHaveURL("/projects/cookguide/campaigns/qr-awareness");
  await expect(page.getByRole("listitem").filter({ hasText: "Busy parents" })).toBeVisible();

  await page.getByRole("link", { name: "New production" }).click();
  await page.waitForURL(/productions\/new$/);
  await hydrated(page);
  await page.getByLabel("Title", { exact: true }).fill("CookGuide QR Code Advert");
  await page.getByRole("button", { name: "Portrait 9:16" }).click();
  await page.getByLabel("FPS", { exact: true }).fill("30");
  await page.getByLabel("Duration (frames)", { exact: true }).fill("360");
  await expect(page.getByText("12s", { exact: true })).toBeVisible();
  await page.getByLabel("Poster frame", { exact: true }).fill("300");
  await page.getByRole("button", { name: "Create production" }).click();

  await expect(page).toHaveURL(PRODUCTION_URL);
  await expect(
    page.getByText("1080×1920 · 30 fps · 360 frames (12s) · poster frame 300 (00:00:10:00)"),
  ).toBeVisible();
  await expect(page.getByText("Valid", { exact: true })).toBeVisible();

  const record = JSON.parse(
    await readFile(
      path.join(
        productionDir("cookguide", "qr-awareness", "cookguide-qr-code-advert"),
        "production.json",
      ),
      "utf8",
    ),
  );
  expect(record).toMatchObject({
    compositionId: "cookguide-cookguide-qr-code-advert",
    posterFrame: 300,
    revision: 1,
  });
});

test("shows field errors and does not create invalid productions", async ({ page }) => {
  await goto(page, "/projects/cookguide/campaigns/qr-awareness/productions/new");
  await page.getByLabel("Title", { exact: true }).fill("Broken");
  await page.getByLabel("Duration (frames)", { exact: true }).fill("360");
  await page.getByLabel("Poster frame", { exact: true }).fill("360");
  await page.getByRole("button", { name: "Create production" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Poster frame must be between 0 and 359" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/productions\/new$/);
});

test("edits and saves the brief and the prompt", async ({ page }) => {
  await editDocument(
    page,
    "brief",
    "## Objective\n",
    "## Objective\nGet home cooks to scan the QR code.\n",
  );
  await editDocument(
    page,
    "prompt",
    "Implement the Remotion composition",
    "Implement the CookGuide advert composition",
  );

  const dir = productionDir("cookguide", "qr-awareness", "cookguide-qr-code-advert");
  expect(await readFile(path.join(dir, "brief.md"), "utf8")).toContain(
    "Get home cooks to scan the QR code.",
  );
  expect(await readFile(path.join(dir, "prompt.md"), "utf8")).toContain(
    "Implement the CookGuide advert composition",
  );

  await goto(page, `${PRODUCTION_URL}?tab=brief`);
  await expect(
    page
      .getByLabel("Production brief preview", { exact: true })
      .getByText("Get home cooks to scan the QR code."),
  ).toBeVisible();
  await expect(page.getByText("Brief 2/13")).toBeVisible();
});

test("renders Markdown previews without executing HTML", async ({ page }) => {
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  await goto(page, `${PRODUCTION_URL}?tab=notes`);
  const editor = page.getByLabel("Notes Markdown", { exact: true });
  await editor.fill('<img src=x onerror="alert(1)"> [link](javascript:alert(2))');
  const preview = page.getByLabel("Notes preview", { exact: true });
  await expect(preview).toContainText('<img src=x onerror="alert(1)">');
  await expect(preview.locator("img")).toHaveCount(0);
  await expect(preview.locator("a")).toHaveCount(0);
  expect(dialogs).toEqual([]);
});

test("refuses to overwrite a document changed on disk", async ({ page }) => {
  await goto(page, `${PRODUCTION_URL}?tab=prompt`);
  const editor = page.getByLabel("Claude prompt Markdown", { exact: true });
  await expect(editor).toBeVisible();

  const file = path.join(
    productionDir("cookguide", "qr-awareness", "cookguide-qr-code-advert"),
    "prompt.md",
  );
  await writeFile(file, "# Edited by Claude Code\n");

  await editor.fill("# My browser edit\n");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "changed on disk" })).toBeVisible();
  expect(await readFile(file, "utf8")).toBe("# Edited by Claude Code\n");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Load latest from disk" }).click();
  await expect(editor).toHaveValue("# Edited by Claude Code\n");
});

test("rejects a stale metadata edit from a second tab", async ({ page, context }) => {
  const other = await context.newPage();
  await goto(page, "/projects/cookguide");
  await goto(other, "/projects/cookguide");

  await page.getByLabel("Description", { exact: true }).fill("Edited in the first tab");
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(page.getByLabel("Description", { exact: true })).toHaveValue(
    "Edited in the first tab",
  );

  await other.getByLabel("Description", { exact: true }).fill("Edited in the second tab");
  await other.getByRole("button", { name: "Save project" }).click();
  await expect(other.getByRole("alert").filter({ hasText: "changed elsewhere" })).toBeVisible();

  const record = JSON.parse(
    await readFile(path.join(workspaceDir, "cookguide/project.json"), "utf8"),
  );
  expect(record).toMatchObject({ description: "Edited in the first tab", revision: 2 });
});

test("archives a production after typed confirmation", async ({ page }) => {
  await goto(page, "/projects/cookguide/campaigns/qr-awareness/productions/new");
  await page.getByLabel("Title", { exact: true }).fill("Throwaway");
  await page.getByRole("button", { name: "Create production" }).click();
  await page.waitForURL(/\/productions\/throwaway$/);
  await hydrated(page);

  await page.getByText("Archive this production").click();
  const button = page.getByRole("button", { name: "Archive production" });
  await expect(button).toBeDisabled();
  await page.getByLabel("Type throwaway to confirm").fill("throwaway");
  await button.click();

  await expect(page).toHaveURL(/\/campaigns\/qr-awareness\?archived=/);
  await expect(page.getByRole("status")).toContainText(".motion-studio/tmp/e2e/archive/");
  await expect(page.getByRole("link", { name: "Throwaway" })).toHaveCount(0);
});

test("keeps core controls keyboard reachable with a visible focus ring", async ({ page }) => {
  await goto(page, "/");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveText(/./);
  const outline = await focused.evaluate((element) => getComputedStyle(element).outlineStyle);
  expect(outline).not.toBe("none");
});

async function editDocument(page: Page, tab: "brief" | "prompt", find: string, replace: string) {
  await goto(page, `${PRODUCTION_URL}?tab=${tab}`);
  const label = tab === "brief" ? "Production brief Markdown" : "Claude prompt Markdown";
  const editor = page.getByLabel(label);
  const original = await editor.inputValue();
  expect(original).toContain(find);
  await editor.fill(original.replace(find, replace));
  await expect(page.getByText("Unsaved changes")).toBeVisible();
  await editor.press("ControlOrMeta+s");
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

test("edits props.json with JSON validation", async ({ page }) => {
  await goto(page, `${PRODUCTION_URL}?tab=props`);
  const editor = page.getByLabel("Props Markdown", { exact: true });
  await expect(editor).toHaveValue("{}\n");
  const save = page.getByRole("button", { name: "Save", exact: true });

  await editor.fill('{ "qrUrl": ');
  await expect(page.getByLabel("Props preview").getByRole("alert")).toContainText("Not valid JSON");
  await expect(save).toBeDisabled();

  await editor.fill('["not", "an", "object"]');
  await expect(page.getByLabel("Props preview").getByRole("alert")).toContainText(
    "Must be a JSON object",
  );

  await editor.fill('{ "qrUrl": "https://cookguide.example/start" }\n');
  await expect(page.getByText("valid JSON object")).toBeVisible();
  await save.click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const file = path.join(
    productionDir("cookguide", "qr-awareness", "cookguide-qr-code-advert"),
    "props.json",
  );
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
    qrUrl: "https://cookguide.example/start",
  });
});
