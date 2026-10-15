import { z } from "zod";
import type { FieldIssue } from "./schemas/parse.ts";

/**
 * Per-production props schema: `props.schema.json`, a deliberately small
 * subset of JSON Schema (draft 2020-12) describing the flat object in
 * `props.json`. Anything outside the subset makes the schema invalid, so a
 * typo can never silently switch validation off. This module is browser-safe:
 * the studio's form uses the same validator as preflight.
 */

export const PROPS_SCHEMA_FILE = "props.schema.json";
export const PROPS_FILE = "props.json";
const MAX_PATTERN_LENGTH = 500;

const common = {
  title: z.string().max(120).optional(),
  description: z.string().max(1000).optional(),
};

const stringField = z.strictObject({
  ...common,
  type: z.literal("string"),
  default: z.string().optional(),
  enum: z.array(z.string()).min(1).max(100).optional(),
  format: z.enum(["uri", "date", "color"]).optional(),
  pattern: z.string().min(1).max(MAX_PATTERN_LENGTH).optional(),
  minLength: z.int().min(0).optional(),
  maxLength: z.int().min(1).max(100_000).optional(),
});

const numberField = z.strictObject({
  ...common,
  type: z.enum(["number", "integer"]),
  default: z.number().optional(),
  enum: z.array(z.number()).min(1).max(100).optional(),
  minimum: z.number().optional(),
  maximum: z.number().optional(),
});

const booleanField = z.strictObject({
  ...common,
  type: z.literal("boolean"),
  default: z.boolean().optional(),
});

export const propsFieldSchema = z.discriminatedUnion("type", [
  stringField,
  numberField,
  booleanField,
]);

/** Property names follow JavaScript identifier rules so compositions can destructure them. */
const propertyName = z
  .string()
  .regex(/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/, "Property names must be valid identifiers");

export const propsSchemaSchema = z
  .strictObject({
    $schema: z.string().optional(),
    title: z.string().max(120).optional(),
    description: z.string().max(2000).optional(),
    type: z.literal("object"),
    properties: z.record(propertyName, propsFieldSchema),
    required: z.array(propertyName).default([]),
    /** Unknown props are always rejected; if present this must say so. */
    additionalProperties: z.literal(false).optional(),
  })
  .superRefine((schema, ctx) => {
    for (const name of schema.required) {
      if (!Object.hasOwn(schema.properties, name)) {
        ctx.addIssue({
          code: "custom",
          path: ["required"],
          message: `"${name}" is required but not defined in properties`,
        });
      }
    }
    for (const [name, field] of Object.entries(schema.properties)) {
      const at = ["properties", name];
      if (field.type === "string") {
        if (field.pattern !== undefined) {
          try {
            new RegExp(field.pattern, "u");
          } catch {
            ctx.addIssue({
              code: "custom",
              path: [...at, "pattern"],
              message: "Not a valid regular expression",
            });
          }
        }
        if (
          field.minLength !== undefined &&
          field.maxLength !== undefined &&
          field.minLength > field.maxLength
        ) {
          ctx.addIssue({
            code: "custom",
            path: [...at, "minLength"],
            message: "minLength is greater than maxLength",
          });
        }
      }
      if (
        (field.type === "number" || field.type === "integer") &&
        field.minimum !== undefined &&
        field.maximum !== undefined &&
        field.minimum > field.maximum
      ) {
        ctx.addIssue({
          code: "custom",
          path: [...at, "minimum"],
          message: "minimum is greater than maximum",
        });
      }
      if (field.default !== undefined) {
        const issue = fieldIssue(field, field.default);
        if (issue)
          ctx.addIssue({
            code: "custom",
            path: [...at, "default"],
            message: `Default is invalid: ${issue}`,
          });
      }
    }
  });

export type PropsField = z.infer<typeof propsFieldSchema>;
export type PropsSchema = z.infer<typeof propsSchemaSchema>;

/** Parse a props schema document. Returns field-level issues instead of throwing. */
export function parsePropsSchema(raw: string): { schema?: PropsSchema; issues: FieldIssue[] } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return {
      issues: [
        {
          path: "",
          message: `Not valid JSON: ${error instanceof Error ? error.message : "parse error"}`,
        },
      ],
    };
  }
  const result = propsSchemaSchema.safeParse(data);
  if (!result.success) {
    return {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.map(String).join("."),
        message: issue.message,
      })),
    };
  }
  return { schema: result.data, issues: [] };
}

/**
 * Validate props against a schema. Issue paths are property names, so the
 * studio can show each message next to its field.
 */
export function validateProps(schema: PropsSchema, props: Record<string, unknown>): FieldIssue[] {
  const issues: FieldIssue[] = [];
  for (const name of schema.required) {
    if (props[name] === undefined) issues.push({ path: name, message: "Required" });
  }
  for (const [name, value] of Object.entries(props)) {
    const field = schema.properties[name];
    if (!field) {
      issues.push({ path: name, message: "Not defined in props.schema.json" });
      continue;
    }
    const issue = fieldIssue(field, value);
    if (issue) issues.push({ path: name, message: issue });
  }
  return issues;
}

/** The value a field takes when props.json leaves it out: the schema default, if any. */
export function effectiveValue(
  schema: PropsSchema,
  props: Record<string, unknown>,
  name: string,
): unknown {
  return props[name] ?? schema.properties[name]?.default;
}

function fieldIssue(field: PropsField, value: unknown): string | undefined {
  switch (field.type) {
    case "boolean":
      return typeof value === "boolean" ? undefined : "Must be true or false";
    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) return "Must be a number";
      if (field.type === "integer" && !Number.isInteger(value)) return "Must be a whole number";
      if (field.minimum !== undefined && value < field.minimum)
        return `Must be at least ${field.minimum}`;
      if (field.maximum !== undefined && value > field.maximum)
        return `Must be at most ${field.maximum}`;
      if (field.enum && !field.enum.includes(value))
        return `Must be one of ${field.enum.join(", ")}`;
      return undefined;
    }
    case "string": {
      if (typeof value !== "string") return "Must be text";
      if (field.minLength !== undefined && value.length < field.minLength) {
        return field.minLength === 1
          ? "Must not be empty"
          : `Must be at least ${field.minLength} characters`;
      }
      if (field.maxLength !== undefined && value.length > field.maxLength)
        return `Must be at most ${field.maxLength} characters`;
      if (field.enum && !field.enum.includes(value))
        return `Must be one of: ${field.enum.join(", ")}`;
      if (field.format === "uri" && !isAbsoluteUrl(value))
        return "Must be a full URL, e.g. https://example.com/page";
      if (field.format === "date" && !isDate(value)) return "Must be a date in YYYY-MM-DD form";
      if (field.format === "color" && !/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value))
        return "Must be a hex colour such as #2E7D4F";
      if (field.pattern !== undefined && !new RegExp(field.pattern, "u").test(value)) {
        // A plain "starts with" pattern such as ^https:// gets a readable message.
        const prefix = /^\^([A-Za-z0-9:/._-]+)$/.exec(field.pattern)?.[1];
        return prefix ? `Must start with ${prefix}` : `Must match the pattern ${field.pattern}`;
      }
      return undefined;
    }
  }
}

function isAbsoluteUrl(value: string): boolean {
  try {
    return new URL(value).protocol.length > 1 && /^[a-z][a-z0-9+.-]*:/i.test(value);
  } catch {
    return false;
  }
}

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}
