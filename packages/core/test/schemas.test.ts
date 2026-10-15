import path from "node:path";
import { describe, expect, it } from "vitest";
import type { MotionStudioError } from "../src/errors.ts";
import { loadSettings } from "../src/repo.ts";
import {
  assetRecordSchema,
  campaignRecordSchema,
  parseRecord,
  productionRecordSchema,
  projectRecordSchema,
  SchemaValidationError,
  settingsSchema,
} from "../src/schemas/index.ts";
import {
  FIXTURE_CAMPAIGN,
  FIXTURE_PRODUCTION,
  FIXTURE_PROJECT,
  readJson,
  REPO_ROOT,
} from "./helpers.ts";

const production = () => readJson(path.join(FIXTURE_PRODUCTION, "production.json"));

describe("record schemas", () => {
  it("accept the fixture records", async () => {
    parseRecord(
      projectRecordSchema,
      await readJson(path.join(FIXTURE_PROJECT, "project.json")),
      "project",
    );
    parseRecord(
      campaignRecordSchema,
      await readJson(path.join(FIXTURE_CAMPAIGN, "campaign.json")),
      "campaign",
    );
    parseRecord(productionRecordSchema, await production(), "production");
  });

  it("rejects a newer schema version with an actionable message", async () => {
    const error = catchError(async () =>
      parseRecord(
        productionRecordSchema,
        { ...(await production()), schemaVersion: 2 },
        "production",
      ),
    );
    await expect(error).resolves.toMatchObject({
      code: "SCHEMA_VERSION_UNSUPPORTED",
      message: expect.stringContaining("Update Motion Studio"),
    });
  });

  it("rejects an obsolete schema version", async () => {
    await expect(
      catchError(async () =>
        parseRecord(
          productionRecordSchema,
          { ...(await production()), schemaVersion: 0 },
          "production",
        ),
      ),
    ).resolves.toMatchObject({ code: "SCHEMA_VERSION_UNSUPPORTED" });
  });

  it("reports field-level issues", async () => {
    const error = await catchError(async () =>
      parseRecord(
        productionRecordSchema,
        { ...(await production()), slug: "Bad Slug", title: "" },
        "production",
      ),
    );
    expect(error).toBeInstanceOf(SchemaValidationError);
    expect((error as SchemaValidationError).issues.map((issue) => issue.path)).toEqual(
      expect.arrayContaining(["slug", "title"]),
    );
  });

  it("rejects unknown fields so typos are not silently ignored", async () => {
    expect(productionRecordSchema.safeParse({ ...(await production()), titel: "x" }).success).toBe(
      false,
    );
  });

  it("requires the poster frame to be inside the duration", async () => {
    const record = await production();
    const format = record.format as { durationInFrames: number };
    expect(
      productionRecordSchema.safeParse({ ...record, posterFrame: format.durationInFrames - 1 })
        .success,
    ).toBe(true);
    const result = productionRecordSchema.safeParse({
      ...record,
      posterFrame: format.durationInFrames,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["posterFrame"]);
  });

  it("requires even dimensions for yuv420p", async () => {
    const record = await production();
    expect(
      productionRecordSchema.safeParse({
        ...record,
        format: { width: 1081, height: 1920, fps: 30, durationInFrames: 360 },
      }).success,
    ).toBe(false);
  });

  it("rejects non-integer frame counts", async () => {
    const record = await production();
    expect(
      productionRecordSchema.safeParse({
        ...record,
        format: { width: 1080, height: 1920, fps: 29.97, durationInFrames: 360 },
      }).success,
    ).toBe(false);
  });

  it("validates asset digests", () => {
    const asset = {
      schemaVersion: 1,
      id: "01a13edc-439a-72c4-9e44-ad989b9fff81",
      originalName: "Logo Final.PNG",
      storedName: "logo-final.png",
      mediaType: "image",
      mimeType: "image/png",
      bytes: 1024,
      sha256: "a".repeat(64),
      createdAt: "2026-10-15T09:00:00.000Z",
    };
    expect(assetRecordSchema.safeParse(asset).success).toBe(true);
    expect(assetRecordSchema.safeParse({ ...asset, sha256: "A".repeat(64) }).success).toBe(false);
  });
});

describe("settings", () => {
  it("loads the repository settings with the three initial profiles", async () => {
    const settings = await loadSettings(REPO_ROOT);
    expect(settings.server.host).toBe("127.0.0.1");
    expect(settings.renderProfiles.map((p) => [p.id, p.crf, p.scale])).toEqual([
      ["draft", 28, 0.5],
      ["standard", 20, 1],
      ["high-quality", 16, 1],
    ]);
  });

  it.each(["/etc", "../outside", "workspace/../..", "C:/x", "a\\b", "a//b", "a\u0000b"])(
    "rejects unsafe workspaceRoot %j",
    async (workspaceRoot) => {
      const settings = await readJson(path.join(REPO_ROOT, ".motion-studio/settings.json"));
      expect(settingsSchema.safeParse({ ...settings, workspaceRoot }).success).toBe(false);
    },
  );

  it("refuses to bind anywhere but loopback", async () => {
    const settings = await readJson(path.join(REPO_ROOT, ".motion-studio/settings.json"));
    expect(
      settingsSchema.safeParse({ ...settings, server: { host: "0.0.0.0", port: 4321 } }).success,
    ).toBe(false);
  });

  it("requires the default profile to exist", async () => {
    const settings = await readJson(path.join(REPO_ROOT, ".motion-studio/settings.json"));
    expect(
      settingsSchema.safeParse({ ...settings, defaultRenderProfileId: "missing" }).success,
    ).toBe(false);
  });
});

async function catchError(fn: () => Promise<unknown>): Promise<MotionStudioError> {
  try {
    await fn();
  } catch (error) {
    return error as MotionStudioError;
  }
  throw new Error("Expected function to throw");
}
