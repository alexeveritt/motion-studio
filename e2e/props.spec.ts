import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { goto, productionDir } from "./helpers.ts";

test.describe.configure({ mode: "serial" });

const ORIGIN = { Origin: "http://127.0.0.1:4331" };
const URL_BASE = "/projects/props-test/campaigns/qr/productions/advert";
const DIR = productionDir("props-test", "qr", "advert");
let productionId: string;

async function post(request: APIRequestContext, url: string, data: unknown) {
  const response = await request.post(url, { data, headers: ORIGIN });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as { id: string };
}

const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const save = (page: Page) => page.getByRole("button", { name: "Save props" });
const readProps = async () =>
  JSON.parse(await readFile(path.join(DIR, "props.json"), "utf8")) as Record<string, unknown>;

test.beforeAll(async ({ request }) => {
  const project = await post(request, "/api/projects", { name: "Props Test" });
  const campaign = await post(request, `/api/projects/${project.id}/campaigns`, { name: "QR" });
  productionId = (
    await post(request, `/api/campaigns/${campaign.id}/productions`, {
      title: "Advert",
      format: { width: 1080, height: 1920, fps: 30, durationInFrames: 60 },
    })
  ).id;
});

test("new productions get a schema and a generated form", async ({ page }) => {
  await goto(page, `${URL_BASE}?tab=props`);
  const headline = field(page, "Headline");
  await expect(headline).toHaveAttribute("placeholder", "Default: Advert");
  await expect(page.getByText("Shown by the placeholder composition")).toBeVisible();

  await headline.fill("Cook tonight");
  await save(page).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved props.json" })).toBeVisible();
  expect(await readProps()).toEqual({ headline: "Cook tonight" });

  await goto(page, `${URL_BASE}?tab=preview`);
  await expect(page.locator(".preview-frame")).toContainText("Cook tonight");
});

test("validates fields against the schema before saving", async ({ page }) => {
  await writeFile(
    path.join(DIR, "props.schema.json"),
    JSON.stringify({
      title: "Advert props",
      type: "object",
      additionalProperties: false,
      required: ["qrUrl"],
      properties: {
        qrUrl: { type: "string", title: "QR destination", format: "uri", pattern: "^https://" },
        headline: { type: "string", title: "Headline", maxLength: 20 },
        variant: { type: "string", title: "Variant", enum: ["warm", "fresh"], default: "warm" },
        loops: { type: "integer", title: "Loops", minimum: 1, maximum: 3 },
        showSafeArea: { type: "boolean", title: "Show safe area", default: false },
      },
    }),
  );
  await goto(page, `${URL_BASE}?tab=props`);
  await expect(page.getByRole("heading", { name: "Advert props" })).toBeVisible();

  await field(page, "QR destination").fill("");
  await field(page, "Headline").fill("This headline is far too long");
  await field(page, "Loops").fill("5");
  await save(page).click();
  const form = page.getByRole("form", { name: "Props" });
  await expect(form.getByRole("alert").filter({ hasText: "Required" })).toBeVisible();
  // maxLength is enforced as the operator types, so over-long text cannot be entered.
  await expect(field(page, "Headline")).toHaveValue("This headline is far");
  await expect(form.getByRole("alert").filter({ hasText: "at most 3" })).toBeVisible();

  await field(page, "QR destination").fill("http://cookguide.example");
  await field(page, "Headline").fill("Cook tonight");
  await field(page, "Loops").fill("2");
  await save(page).click();
  await expect(
    form.getByRole("alert").filter({ hasText: "Must start with https://" }),
  ).toBeVisible();

  await field(page, "QR destination").fill("https://cookguide.example/start");
  await field(page, "Variant").selectOption("fresh");
  await field(page, "Show safe area").selectOption("true");
  await save(page).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved props.json" })).toBeVisible();
  expect(await readProps()).toEqual({
    qrUrl: "https://cookguide.example/start",
    headline: "Cook tonight",
    variant: "fresh",
    loops: 2,
    showSafeArea: true,
  });
});

test("flags and removes values the schema does not define", async ({ page }) => {
  await writeFile(
    path.join(DIR, "props.json"),
    JSON.stringify({ qrUrl: "https://cookguide.example/start", qrURL: "typo" }),
  );
  await goto(page, `${URL_BASE}?tab=props`);
  await expect(page.getByRole("alert").filter({ hasText: "does not define" })).toContainText(
    "qrURL",
  );
  await save(page).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved props.json" })).toBeVisible();
  expect(await readProps()).toEqual({ qrUrl: "https://cookguide.example/start" });
});

test("the server enforces the schema even without the form", async ({ request }) => {
  const current = (await (
    await request.get(`/api/documents/production/${productionId}/props`)
  ).json()) as { hash: string };
  const response = await request.put(`/api/documents/production/${productionId}/props`, {
    data: { content: '{ "qrUrl": "ftp://x.example" }', baseHash: current.hash },
    headers: ORIGIN,
  });
  expect(response.status()).toBe(400);
  const body = (await response.json()) as { error: { issues: { path: string }[] } };
  expect(body.error.issues.map((issue) => issue.path)).toEqual(["qrUrl"]);
});

test("a broken schema is explained and blocks preflight", async ({ page, request }) => {
  await writeFile(
    path.join(DIR, "props.schema.json"),
    JSON.stringify({ type: "object", properties: { qrUrl: { type: "url" } } }),
  );
  await goto(page, `${URL_BASE}?tab=props`);
  await expect(page.getByRole("heading", { name: "The props schema is invalid" })).toBeVisible();
  await expect(page.getByText("Edit props.json")).toBeVisible();

  const preflight = await request.post(`/api/productions/${productionId}/preflight`, {
    data: { profileId: "draft" },
    headers: ORIGIN,
  });
  const result = (await preflight.json()) as {
    ok: boolean;
    checks: { id: string; status: string }[];
  };
  expect(result.ok).toBe(false);
  expect(result.checks.find((check) => check.id === "props")?.status).toBe("fail");
});
