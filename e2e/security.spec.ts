import path from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE = "http://127.0.0.1:4331";
const ORIGIN = { Origin: BASE };
const REPO_ROOT = path.resolve(import.meta.dirname, "..");
let productionId: string;
let projectId: string;

async function post(request: APIRequestContext, url: string, data: unknown) {
  const response = await request.post(url, { data, headers: ORIGIN });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()) as { id: string };
}

test.beforeAll(async ({ request }) => {
  const project = await post(request, "/api/projects", { name: "Security Test" });
  projectId = project.id;
  const campaign = await post(request, `/api/projects/${project.id}/campaigns`, { name: "Probe" });
  productionId = (
    await post(request, `/api/campaigns/${campaign.id}/productions`, {
      title: "Target",
      format: { width: 1080, height: 1920, fps: 30, durationInFrames: 60 },
    })
  ).id;
});

test.describe("network controls", () => {
  test("refuses non-loopback Host headers (DNS rebinding)", async ({ request }) => {
    for (const url of ["/", "/api/catalog"]) {
      const response = await request.get(url, { headers: { Host: "attacker.example:4331" } });
      expect([403, 421]).toContain(response.status());
    }
  });

  test("requires a same-origin Origin header on every mutation", async ({ request }) => {
    const body = { data: { name: "Nope" } };
    expect((await request.post("/api/projects", body)).status()).toBe(403);
    expect(
      (
        await request.post("/api/projects", { ...body, headers: { Origin: "http://evil.example" } })
      ).status(),
    ).toBe(403);
    expect(
      (await request.post("/api/projects", { ...body, headers: { Origin: "null" } })).status(),
    ).toBe(403);
    expect(
      (
        await request.delete(`/api/projects/${projectId}`, {
          data: { confirmSlug: "security-test" },
          headers: { Origin: "http://localhost:9999" },
        })
      ).status(),
    ).toBe(403);
  });

  test("sends restrictive headers and no CORS grants", async ({ request }) => {
    const response = await request.get("/api/catalog", {
      headers: { Origin: "http://evil.example" },
    });
    const headers = response.headers();
    expect(headers["access-control-allow-origin"]).toBeUndefined();
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["content-security-policy"]).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)/);
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
  });
});

test.describe("request validation", () => {
  test("rejects wrong content types and oversized bodies", async ({ request }) => {
    const wrongType = await request.post("/api/projects", {
      data: "name=x",
      headers: { ...ORIGIN, "Content-Type": "text/plain" },
    });
    expect(wrongType.status()).toBe(415);
    const tooLarge = await request.post("/api/projects", {
      data: JSON.stringify({ name: "x".repeat(1_100_000) }),
      headers: { ...ORIGIN, "Content-Type": "application/json" },
    });
    expect(tooLarge.status()).toBe(413);
    const notJson = await request.post("/api/projects", {
      data: "{nope",
      headers: { ...ORIGIN, "Content-Type": "application/json" },
    });
    expect(notJson.status()).toBe(400);
  });

  test("returns field errors for invalid input without creating anything", async ({ request }) => {
    const response = await request.post("/api/projects", {
      data: { name: "", slug: "../../etc" },
      headers: ORIGIN,
    });
    expect(response.status()).toBe(400);
    const body = (await response.json()) as { error: { code: string; issues: { path: string }[] } };
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.issues.map((issue) => issue.path).sort()).toEqual(["name", "slug"]);
  });
});

test.describe("filesystem boundary", () => {
  const traversal = [
    "..%2F..%2F..%2Fpackage.json",
    "..%2Fproduction.json",
    "%2Fetc%2Fpasswd",
    "..",
    "%00",
  ];

  test("documents only serve allowlisted kinds", async ({ request }) => {
    for (const kind of traversal) {
      expect(
        (await request.get(`/api/documents/production/${productionId}/${kind}`)).status(),
      ).toBe(404);
    }
    expect((await request.get(`/api/documents/evil/${productionId}/brief`)).status()).toBe(404);
    expect((await request.get(`/api/documents/production/not-an-id/brief`)).status()).toBe(404);
  });

  test("asset, output and render routes reject traversal", async ({ request }) => {
    for (const name of traversal) {
      expect(
        (await request.get(`/api/productions/${productionId}/asset/brand/${name}`)).status(),
      ).toBeGreaterThanOrEqual(400);
      expect((await request.get(`/api/productions/${productionId}/outputs/${name}`)).status()).toBe(
        404,
      );
      expect((await request.get(`/api/renders/${name}`)).status()).toBe(404);
    }
    expect((await request.get(`/api/assets/evil/${projectId}`)).status()).toBe(404);
  });

  test("error responses never contain absolute paths or stack traces", async ({ request }) => {
    const responses = await Promise.all([
      request.get(`/api/documents/production/${productionId}/nope`),
      request.get(`/api/productions/${productionId}/asset/brand/missing.png`),
      request.post(`/api/productions/${productionId}/preflight`, {
        data: { profileId: "nope" },
        headers: ORIGIN,
      }),
      request.post(`/api/assets/production/${productionId}`, {
        data: Buffer.from("MZ\x90\x00"),
        headers: { ...ORIGIN, "Content-Type": "application/octet-stream", "X-File-Name": "x.exe" },
      }),
    ]);
    for (const response of responses) {
      const text = await response.text();
      expect(text).not.toContain(REPO_ROOT);
      expect(text).not.toMatch(/\bat .+\(.+:\d+:\d+\)/);
    }
  });
});
