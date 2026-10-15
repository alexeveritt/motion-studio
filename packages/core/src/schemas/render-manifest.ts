import { z } from "zod";
import { profileId, recordId, schemaVersion, slug, timestamp } from "./common.ts";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const relativePath = z.string().min(1).max(1000);

export const renderManifestSchema = z.strictObject({
  schemaVersion,
  renderId: z.string().min(1).max(100),
  productionId: recordId,
  compositionId: slug,
  profileId,
  requestedAt: timestamp,
  startedAt: timestamp,
  completedAt: timestamp,
  status: z.enum(["succeeded", "failed", "cancelled"]),
  inputFingerprint: sha256,
  git: z.strictObject({ commit: z.string().optional(), dirty: z.boolean() }).optional(),
  environment: z.strictObject({
    node: z.string(),
    pnpm: z.string(),
    remotion: z.string(),
    platform: z.string(),
    architecture: z.string(),
  }),
  video: z.strictObject({
    relativePath,
    sha256,
    bytes: z.int().min(0),
    width: z.int().positive(),
    height: z.int().positive(),
    fps: z.number().positive(),
    durationInFrames: z.int().positive(),
    durationSeconds: z.number().positive(),
    codec: z.string(),
    pixelFormat: z.string(),
  }),
  poster: z.strictObject({ relativePath, frame: z.int().min(0), sha256 }).optional(),
  warnings: z.array(z.string()),
  error: z.strictObject({ code: z.string(), message: z.string() }).optional(),
});

export type RenderManifest = z.infer<typeof renderManifestSchema>;

/** Manifest for a standalone poster render (no video). */
export const posterManifestSchema = z.strictObject({
  schemaVersion,
  renderId: z.string().min(1).max(100),
  productionId: recordId,
  compositionId: slug,
  profileId,
  requestedAt: timestamp,
  startedAt: timestamp,
  completedAt: timestamp,
  status: z.literal("succeeded"),
  inputFingerprint: sha256,
  git: z.strictObject({ commit: z.string().optional(), dirty: z.boolean() }).optional(),
  environment: z.strictObject({
    node: z.string(),
    pnpm: z.string(),
    remotion: z.string(),
    platform: z.string(),
    architecture: z.string(),
  }),
  poster: z.strictObject({
    relativePath,
    frame: z.int().min(0),
    sha256,
    bytes: z.int().min(0),
    width: z.int().positive(),
    height: z.int().positive(),
  }),
  warnings: z.array(z.string()),
});

export type PosterManifest = z.infer<typeof posterManifestSchema>;
