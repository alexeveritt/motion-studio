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

export const productionStatus = z.enum([
  "idea",
  "briefing",
  "in-development",
  "review",
  "approved",
  "archived",
]);

/**
 * Hard structural bounds. Repository settings apply tighter, configurable
 * limits during preflight.
 */
export const productionFormatSchema = z.strictObject({
  width: z.int().min(16).max(7680),
  height: z.int().min(16).max(7680),
  fps: z.int().min(1).max(120),
  durationInFrames: z
    .int()
    .min(1)
    .max(120 * 60 * 60),
});

export const productionRecordSchema = z
  .strictObject({
    schemaVersion,
    id: recordId,
    projectId: recordId,
    campaignId: recordId,
    slug,
    title: nonEmptyText(160),
    description: optionalText(2000),
    status: productionStatus,
    compositionId: slug,
    format: productionFormatSchema,
    files: z.strictObject({
      brief: z.literal("brief.md"),
      prompt: z.literal("prompt.md"),
      notes: z.literal("notes.md"),
      entry: z.literal("src/composition.tsx"),
    }),
    defaultRenderProfileId: profileId,
    posterFrame: z.int().min(0),
    tags: z.array(slug).max(30),
    createdAt: timestamp,
    updatedAt: timestamp,
    revision,
  })
  .superRefine((record, ctx) => {
    if (record.posterFrame >= record.format.durationInFrames) {
      ctx.addIssue({
        code: "custom",
        path: ["posterFrame"],
        message: `Poster frame must be between 0 and ${record.format.durationInFrames - 1}`,
      });
    }
    if (record.format.width % 2 !== 0 || record.format.height % 2 !== 0) {
      ctx.addIssue({
        code: "custom",
        path: ["format"],
        message: "Width and height must be even for H.264 yuv420p output",
      });
    }
  });

export type ProductionRecord = z.infer<typeof productionRecordSchema>;
export type ProductionFormat = z.infer<typeof productionFormatSchema>;
