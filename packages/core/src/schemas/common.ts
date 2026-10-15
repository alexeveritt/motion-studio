import { z } from "zod";
import { SLUG_MAX_LENGTH, isValidSlug } from "../slug.ts";

export const CURRENT_SCHEMA_VERSION = 1;

export const schemaVersion = z.literal(CURRENT_SCHEMA_VERSION);
export const recordId = z.uuid({ error: "Must be a UUID" });
export const slug = z
  .string()
  .max(SLUG_MAX_LENGTH)
  .refine(isValidSlug, "Use lowercase letters, digits and single hyphens");
export const timestamp = z.iso.datetime({ offset: true, error: "Must be an ISO 8601 timestamp" });
export const revision = z.int().min(1);
export const nonEmptyText = (max: number) => z.string().trim().min(1, "Required").max(max);
export const optionalText = (max: number) => z.string().max(max);
export const textList = z.array(z.string().trim().min(1).max(500)).max(50);

/** Profile IDs follow slug rules so they are safe inside output file names. */
export const profileId = slug;
