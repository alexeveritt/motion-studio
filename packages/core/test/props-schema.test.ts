import { describe, expect, it } from "vitest";
import {
  effectiveValue,
  parsePropsSchema,
  validateProps,
  type PropsSchema,
} from "../src/props-schema.ts";

const COOKGUIDE = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["qrUrl"],
  properties: {
    qrUrl: { type: "string", format: "uri", pattern: "^https://", title: "QR destination" },
    headline: { type: "string", maxLength: 40, default: "Scan to start cooking" },
    launchDate: { type: "string", format: "date" },
    accent: { type: "string", format: "color", default: "#2E7D4F" },
    variant: { type: "string", enum: ["warm", "fresh"] },
    loops: { type: "integer", minimum: 1, maximum: 3, default: 1 },
    speed: { type: "number", minimum: 0.5, maximum: 2 },
    showSafeArea: { type: "boolean", default: false },
  },
};

function schema(overrides: Record<string, unknown> = {}): PropsSchema {
  const parsed = parsePropsSchema(JSON.stringify({ ...COOKGUIDE, ...overrides }));
  if (!parsed.schema) throw new Error(JSON.stringify(parsed.issues));
  return parsed.schema;
}

describe("parsePropsSchema", () => {
  it("accepts the supported subset of JSON Schema", () => {
    const parsed = parsePropsSchema(JSON.stringify(COOKGUIDE));
    expect(parsed.issues).toEqual([]);
    expect(Object.keys(parsed.schema!.properties)).toEqual([
      "qrUrl",
      "headline",
      "launchDate",
      "accent",
      "variant",
      "loops",
      "speed",
      "showSafeArea",
    ]);
  });

  it.each<[string, unknown, string]>([
    ["invalid JSON", "{ nope", "Not valid JSON"],
    ["unknown top-level keyword", { ...COOKGUIDE, oneOf: [] }, ""],
    [
      "unknown field keyword (typo)",
      { ...COOKGUIDE, properties: { qrUrl: { type: "string", formatt: "uri" } } },
      "properties.qrUrl",
    ],
    [
      "unsupported type",
      { ...COOKGUIDE, properties: { list: { type: "array" } } },
      "properties.list",
    ],
    [
      "additional properties allowed",
      { ...COOKGUIDE, additionalProperties: true },
      "additionalProperties",
    ],
    ["required but undefined", { ...COOKGUIDE, required: ["missing"] }, "required"],
    [
      "bad property name",
      { ...COOKGUIDE, properties: { "qr-url": { type: "string" } }, required: [] },
      "properties",
    ],
    [
      "bad pattern",
      { ...COOKGUIDE, properties: { a: { type: "string", pattern: "(" } }, required: [] },
      "properties.a.pattern",
    ],
    [
      "invalid default",
      {
        ...COOKGUIDE,
        properties: { a: { type: "integer", minimum: 2, default: 1 } },
        required: [],
      },
      "properties.a.default",
    ],
    [
      "min above max",
      { ...COOKGUIDE, properties: { a: { type: "number", minimum: 3, maximum: 1 } }, required: [] },
      "properties.a.minimum",
    ],
  ])("rejects %s", (_label, input, path) => {
    // `path` is the expected issue path prefix (or message prefix for parse errors).
    const parsed = parsePropsSchema(typeof input === "string" ? input : JSON.stringify(input));
    expect(parsed.schema).toBeUndefined();
    expect(parsed.issues.length).toBeGreaterThan(0);
    expect(
      parsed.issues.some((issue) => issue.path.startsWith(path) || issue.message.startsWith(path)),
    ).toBe(true);
  });
});

describe("validateProps", () => {
  it("accepts valid props", () => {
    expect(
      validateProps(schema(), {
        qrUrl: "https://cookguide.example/start",
        headline: "Cook tonight",
        launchDate: "2026-11-01",
        accent: "#E4572E",
        variant: "warm",
        loops: 2,
        speed: 1.5,
        showSafeArea: true,
      }),
    ).toEqual([]);
  });

  it.each<[string, Record<string, unknown>, string, string]>([
    ["a missing required value", {}, "qrUrl", "Required"],
    ["a non-https URL", { qrUrl: "http://cookguide.example" }, "qrUrl", "Must start with https://"],
    ["a relative URL", { qrUrl: "https:" }, "qrUrl", "Must be a full URL"],
    [
      "text that is too long",
      { qrUrl: "https://x.example", headline: "x".repeat(41) },
      "headline",
      "at most 40",
    ],
    [
      "an impossible date",
      { qrUrl: "https://x.example", launchDate: "2026-02-30" },
      "launchDate",
      "YYYY-MM-DD",
    ],
    ["a bad colour", { qrUrl: "https://x.example", accent: "green" }, "accent", "hex colour"],
    [
      "a value outside the enum",
      { qrUrl: "https://x.example", variant: "cold" },
      "variant",
      "one of: warm, fresh",
    ],
    ["a fractional integer", { qrUrl: "https://x.example", loops: 1.5 }, "loops", "whole number"],
    ["a number out of range", { qrUrl: "https://x.example", speed: 3 }, "speed", "at most 2"],
    [
      "a wrong type",
      { qrUrl: "https://x.example", showSafeArea: "yes" },
      "showSafeArea",
      "true or false",
    ],
    ["an unknown prop", { qrUrl: "https://x.example", qrURL: "typo" }, "qrURL", "Not defined"],
  ])("reports %s", (_label, props, path, message) => {
    expect(validateProps(schema(), props)).toEqual([
      { path, message: expect.stringContaining(message) },
    ]);
  });

  it("keeps the generic message for patterns that are not a simple prefix", () => {
    const custom = schema({
      properties: { code: { type: "string", pattern: "^[A-Z]{3}-\\d+$" } },
      required: [],
    });
    expect(validateProps(custom, { code: "abc" })).toEqual([
      { path: "code", message: "Must match the pattern ^[A-Z]{3}-\\d+$" },
    ]);
  });

  it("uses schema defaults for omitted values", () => {
    expect(effectiveValue(schema(), {}, "headline")).toBe("Scan to start cooking");
    expect(effectiveValue(schema(), { headline: "Mine" }, "headline")).toBe("Mine");
    expect(effectiveValue(schema(), {}, "speed")).toBeUndefined();
  });
});

describe("propsStatus (preflight and validate:workspace)", async () => {
  const { propsStatus } = await import("../src/render/preflight.ts");
  const base = {
    props: { path: "p/props.json", exists: true, props: {} as Record<string, unknown> },
    schema: { path: "p/props.schema.json", exists: false, issues: [] },
    propsIssues: [],
  };

  it("passes with no props and no schema", () => {
    expect(propsStatus(base)).toEqual(["pass", ["No props"]]);
  });

  it("warns when props exist without a schema", () => {
    expect(
      propsStatus({ ...base, props: { ...base.props, props: { qrUrl: "https://x" } } })[0],
    ).toBe("warn");
  });

  it("fails on unreadable props, a broken schema, or props that break the schema", () => {
    expect(
      propsStatus({ ...base, props: { ...base.props, error: "props.json is not valid JSON" } }),
    ).toEqual(["fail", ["p/props.json: props.json is not valid JSON"]]);
    expect(
      propsStatus({
        ...base,
        schema: {
          ...base.schema,
          exists: true,
          issues: [{ path: "properties.x.type", message: "Invalid input" }],
        },
      }),
    ).toEqual(["fail", ["p/props.schema.json properties.x.type: Invalid input"]]);
    expect(
      propsStatus({
        ...base,
        schema: { ...base.schema, exists: true, schema: schema() },
        propsIssues: [{ path: "qrUrl", message: "Required" }],
      }),
    ).toEqual(["fail", ["qrUrl: Required"]]);
  });

  it("passes valid props against a schema", () => {
    expect(
      propsStatus({ ...base, schema: { ...base.schema, exists: true, schema: schema() } }),
    ).toEqual(["pass", ["8 props defined; props.json is valid"]]);
  });
});
