import { z } from "zod";
import { optionalText, recordId, schemaVersion, timestamp } from "./common.ts";

export const mediaType = z.enum(["image", "audio", "video", "font", "document", "other"]);

export const assetRecordSchema = z.strictObject({
  schemaVersion,
  id: recordId,
  originalName: z.string().min(1).max(255),
  storedName: z.string().min(1).max(255),
  mediaType,
  mimeType: z.string().min(1).max(255),
  bytes: z.int().min(0),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, "Must be a lowercase hex SHA-256 digest"),
  width: z.int().positive().optional(),
  height: z.int().positive().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  source: optionalText(1000).optional(),
  licenceNotes: optionalText(2000).optional(),
  altText: optionalText(1000).optional(),
  createdAt: timestamp,
});

export type AssetRecord = z.infer<typeof assetRecordSchema>;
