import { z } from "zod";
import { nonEmptyText, profileId } from "./common.ts";

export const renderProfileSchema = z.strictObject({
  id: profileId,
  name: nonEmptyText(80),
  container: z.literal("mp4"),
  codec: z.literal("h264"),
  pixelFormat: z.literal("yuv420p"),
  crf: z.int().min(0).max(51),
  audioCodec: z.literal("aac"),
  audioBitrate: z.string().regex(/^\d{2,3}k$/, 'Use a bitrate such as "192k"'),
  concurrency: z.int().min(1).max(64),
  imageFormat: z.enum(["jpeg", "png"]),
  scale: z.number().positive().max(4).optional(),
  muted: z.boolean().optional(),
});

export type RenderProfile = z.infer<typeof renderProfileSchema>;
