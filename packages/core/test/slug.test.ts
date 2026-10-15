import { describe, expect, it } from "vitest";
import { isValidSlug, slugify } from "../src/slug.ts";

describe("slugify", () => {
  it.each([
    ["CookGuide", "cookguide"],
    ["QR Code Advert", "qr-code-advert"],
    ["  Crème brûlée -- launch!  ", "creme-brulee-launch"],
    ["../../etc/passwd", "etc-passwd"],
    ["a/b\\c", "a-b-c"],
    ["Ünïcödé 2026", "unicode-2026"],
  ])("%j -> %j", (input, expected) => {
    expect(slugify(input)).toBe(expected);
  });

  it("returns an empty string when nothing usable remains", () => {
    expect(slugify("!!!")).toBe("");
    expect(slugify("日本語")).toBe("");
  });

  it("avoids reserved device names", () => {
    expect(slugify("CON")).toBe("con-item");
    expect(slugify("New")).toBe("new-item");
    expect(isValidSlug(slugify("aux"))).toBe(true);
  });

  it("caps length without leaving a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(63)} b`);
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith("-")).toBe(false);
  });
});

describe("isValidSlug", () => {
  it.each(["cookguide", "qr-code-advert", "a1", "2026-launch"])("accepts %j", (value) => {
    expect(isValidSlug(value)).toBe(true);
  });

  it.each([
    "",
    "..",
    ".hidden",
    "Upper",
    "double--hyphen",
    "-leading",
    "trailing-",
    "a_b",
    "a/b",
    "con",
    "lpt1",
    "a".repeat(65),
  ])("rejects %j", (value) => {
    expect(isValidSlug(value)).toBe(false);
  });
});
