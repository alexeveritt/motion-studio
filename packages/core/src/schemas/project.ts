import { z } from "zod";
import {
  nonEmptyText,
  optionalText,
  profileId,
  recordId,
  revision,
  schemaVersion,
  slug,
  timestamp,
} from "./common.ts";

export const projectStatus = z.enum(["active", "archived"]);

export const projectRecordSchema = z.strictObject({
  schemaVersion,
  id: recordId,
  slug,
  name: nonEmptyText(120),
  description: optionalText(2000),
  status: projectStatus,
  sourceRepository: z
    .strictObject({
      // Informational only: never read from or executed in version one.
      path: nonEmptyText(1000),
      label: optionalText(120).optional(),
    })
    .optional(),
  defaultRenderProfileId: profileId,
  contextFile: z.literal("context.md"),
  brandFile: z.literal("brand/brand.md").optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
  revision,
});

export type ProjectRecord = z.infer<typeof projectRecordSchema>;
