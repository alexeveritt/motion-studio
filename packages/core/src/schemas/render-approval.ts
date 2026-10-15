import { z } from "zod";
import { profileId, recordId, schemaVersion, timestamp } from "./common.ts";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
/** Paths are relative to the production folder, as in render manifests. */
const file = z.strictObject({ relativePath: z.string().min(1).max(1000), sha256 });

/**
 * `renders/approved.json`: marks one successful video render of a production
 * as the approved final. Hashes pin the exact manifest, video and poster, so
 * replacing or editing any of them after approval is detected.
 */
export const renderApprovalSchema = z.strictObject({
  schemaVersion,
  productionId: recordId,
  renderId: z.string().min(1).max(100),
  profileId,
  inputFingerprint: sha256,
  manifest: file,
  video: file,
  poster: file.optional(),
  approvedAt: timestamp,
  note: z.string().trim().max(1000).optional(),
});

export type RenderApproval = z.infer<typeof renderApprovalSchema>;

export const renderApprovalInputSchema = z.strictObject({
  renderId: z.string().min(1).max(100),
  /** Hash of approved.json as loaded ("" content hash when there was none). */
  baseHash: z.string().regex(/^[a-f0-9]{64}$/),
  note: z.string().trim().max(1000).optional(),
});

/** Move finished renders to the archive. */
export const renderArchiveInputSchema = z.strictObject({
  renderIds: z
    .array(z.string().min(1).max(100))
    .min(1)
    .max(500)
    .refine((ids) => new Set(ids).size === ids.length, "Each render may be listed once"),
});

export const renderApprovalRemoveSchema = z.strictObject({
  baseHash: z.string().regex(/^[a-f0-9]{64}$/),
});
