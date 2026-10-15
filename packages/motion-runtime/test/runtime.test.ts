import { describe, expect, it } from "vitest";
import { parseAssetRef } from "../src/assets.tsx";
import { resolveInputProps, validateComposition } from "../src/composition.ts";
import { seededInt, seededRange } from "../src/deterministic.ts";

const Component = () => null;

describe("validateComposition", () => {
  it("accepts a well-formed entry", () => {
    const composition = {
      id: "brand-advert",
      Component,
      defaultProps: { url: "https://example.com" },
    };
    expect(validateComposition({ composition }, "brand-advert", "src/composition.tsx")).toBe(
      composition,
    );
  });

  it.each([
    [{}, "must export"],
    [{ composition: { id: "other", Component, defaultProps: {} } }, 'expects "brand-advert"'],
    [
      { composition: { id: "brand-advert", Component: "div", defaultProps: {} } },
      "must be a React component",
    ],
    [
      { composition: { id: "brand-advert", Component, defaultProps: [] } },
      "defaultProps must be an object",
    ],
  ])("explains what is wrong with %j", (module, message) => {
    expect(() => validateComposition(module, "brand-advert", "src/composition.tsx")).toThrow(
      message,
    );
  });
});

describe("resolveInputProps", () => {
  it("overlays production props on the defaults", () => {
    const composition = {
      id: "x",
      Component,
      defaultProps: { url: "https://default.example", headline: "Hi" },
    };
    expect(resolveInputProps(composition, { url: "https://cookguide.example" })).toEqual({
      url: "https://cookguide.example",
      headline: "Hi",
    });
    expect(resolveInputProps(composition, undefined)).toEqual(composition.defaultProps);
  });
});

describe("parseAssetRef", () => {
  it.each([
    ["production:logo.png", "production", "logo.png"],
    ["brand:wordmark-v2.svg", "brand", "wordmark-v2.svg"],
    ["campaign:Hero_Image.JPG", "campaign", "Hero_Image.JPG"],
  ])("parses %s", (ref, scope, name) => {
    expect(parseAssetRef(ref)).toEqual({ scope, name });
  });

  it.each([
    "logo.png",
    "public:logo.png",
    "production:../production.json",
    "production:sub/logo.png",
    "production:.hidden",
    "production:logo.png.asset.json",
    "production:",
    "production:a..b.png",
  ])("rejects %j", (ref) => {
    expect(() => parseAssetRef(ref)).toThrow();
  });
});

describe("seeded helpers", () => {
  it("are deterministic and in range", () => {
    expect(seededRange("steam", 10, 20)).toBe(seededRange("steam", 10, 20));
    for (let i = 0; i < 200; i++) {
      const value = seededInt(i, 1, 6);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
  });
});
