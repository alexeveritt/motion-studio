import type { z } from "zod";
import { MotionStudioError } from "../errors.ts";
import { CURRENT_SCHEMA_VERSION } from "./common.ts";

export type RecordKind =
  "project" | "campaign" | "production" | "asset" | "render manifest" | "settings";

export type FieldIssue = { path: string; message: string };

/**
 * Parse a persisted record. Version is checked before shape so a file written
 * by a newer Motion Studio fails closed with an actionable message instead of
 * a wall of field errors.
 */
export function parseRecord<T extends z.ZodType>(
  schema: T,
  data: unknown,
  kind: RecordKind,
): z.infer<T> {
  const version =
    typeof data === "object" && data !== null && "schemaVersion" in data
      ? (data as { schemaVersion: unknown }).schemaVersion
      : undefined;

  if (typeof version === "number" && version !== CURRENT_SCHEMA_VERSION) {
    throw new MotionStudioError(
      "SCHEMA_VERSION_UNSUPPORTED",
      version > CURRENT_SCHEMA_VERSION
        ? `This ${kind} uses schema version ${version}, but this Motion Studio supports version ${CURRENT_SCHEMA_VERSION}. Update Motion Studio before editing it.`
        : `This ${kind} uses obsolete schema version ${version}. Migrate it to version ${CURRENT_SCHEMA_VERSION}.`,
    );
  }

  const result = schema.safeParse(data);
  if (!result.success) {
    throw new SchemaValidationError(kind, formatIssues(result.error));
  }
  return result.data;
}

export class SchemaValidationError extends MotionStudioError {
  readonly issues: FieldIssue[];

  constructor(
    kind: string,
    issues: FieldIssue[],
    code: "SCHEMA_INVALID" | "INVALID_INPUT" = "SCHEMA_INVALID",
  ) {
    super(
      code,
      `Invalid ${kind}: ${issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ")}`,
    );
    this.issues = issues;
  }
}

/** Parse untrusted request input. Throws INVALID_INPUT with field-level issues. */
export function parseInput<T extends z.ZodType>(
  schema: T,
  data: unknown,
  kind: string,
): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new SchemaValidationError(kind, formatIssues(result.error), "INVALID_INPUT");
  }
  return result.data;
}

export function formatIssues(error: z.ZodError): FieldIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}
