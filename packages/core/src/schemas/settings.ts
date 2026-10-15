import { z } from "zod";
import { profileId, schemaVersion } from "./common.ts";
import { renderProfileSchema } from "./render-profile.ts";

/** Repository-relative path: no absolute paths, traversal, backslashes or control characters. */
export const repoRelativePath = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !/^[a-zA-Z]:/.test(value) &&
      !value.includes("\\") &&
      // eslint-disable-next-line no-control-regex
      !/[\u0000-\u001f\u007f]/.test(value) &&
      value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "Must be a repository-relative path without traversal",
  );

export const settingsSchema = z
  .strictObject({
    schemaVersion,
    workspaceRoot: repoRelativePath,
    server: z.strictObject({
      host: z.literal("127.0.0.1"),
      port: z.int().min(1024).max(65535),
    }),
    limits: z.strictObject({
      maxUploadBytes: z.int().positive(),
      maxProjectBytes: z.int().positive(),
      maxWidth: z.int().positive(),
      maxHeight: z.int().positive(),
      maxFps: z.int().positive(),
      maxDurationInFrames: z.int().positive(),
      renderTimeoutSeconds: z.int().positive(),
    }),
    defaultRenderProfileId: profileId,
    renderProfiles: z.array(renderProfileSchema).min(1),
    repositoryAliases: z.record(z.string().regex(/^[a-z0-9-]+$/), z.string().max(1000)).default({}),
  })
  .superRefine((settings, ctx) => {
    const ids = settings.renderProfiles.map((profile) => profile.id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (duplicates.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["renderProfiles"],
        message: `Duplicate render profile IDs: ${[...new Set(duplicates)].join(", ")}`,
      });
    }
    if (!ids.includes(settings.defaultRenderProfileId)) {
      ctx.addIssue({
        code: "custom",
        path: ["defaultRenderProfileId"],
        message: `Default profile "${settings.defaultRenderProfileId}" is not defined`,
      });
    }
  });

export type Settings = z.infer<typeof settingsSchema>;
