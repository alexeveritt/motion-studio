import { z } from "zod";
import { campaignStatus } from "./campaign.ts";
import { nonEmptyText, optionalText, profileId, revision, slug, textList } from "./common.ts";
import { productionFormatSchema, productionStatus } from "./production.ts";
import { projectStatus } from "./project.ts";

/**
 * Request bodies accepted by the local API. These are shared with browser
 * forms, so this module must not import Node built-ins.
 */

const optionalSlug = z.preprocess((value) => (value === "" ? undefined : value), slug.optional());

const sourceRepository = z
  .strictObject({ path: nonEmptyText(1000), label: optionalText(120).optional() })
  .nullable();

export const projectCreateInputSchema = z.strictObject({
  name: nonEmptyText(120),
  description: optionalText(2000).default(""),
  slug: optionalSlug,
  defaultRenderProfileId: profileId.optional(),
  sourceRepository: sourceRepository.optional(),
});

export const projectUpdateInputSchema = z.strictObject({
  revision,
  name: nonEmptyText(120),
  description: optionalText(2000),
  status: projectStatus,
  defaultRenderProfileId: profileId,
  sourceRepository,
});

const campaignFields = {
  name: nonEmptyText(120),
  description: optionalText(2000),
  objective: optionalText(2000),
  audience: textList,
  keyMessages: textList,
  channels: textList,
};

export const campaignCreateInputSchema = z.strictObject({
  ...campaignFields,
  description: campaignFields.description.default(""),
  objective: campaignFields.objective.default(""),
  audience: textList.default([]),
  keyMessages: textList.default([]),
  channels: textList.default([]),
  slug: optionalSlug,
});

export const campaignUpdateInputSchema = z.strictObject({
  ...campaignFields,
  revision,
  status: campaignStatus,
});

export const productionCreateInputSchema = z.strictObject({
  title: nonEmptyText(160),
  description: optionalText(2000).default(""),
  slug: optionalSlug,
  format: productionFormatSchema,
  posterFrame: z.int().min(0).optional(),
  defaultRenderProfileId: profileId.optional(),
  tags: z.array(slug).max(30).default([]),
});

export const productionUpdateInputSchema = z.strictObject({
  revision,
  title: nonEmptyText(160),
  description: optionalText(2000),
  status: productionStatus,
  format: productionFormatSchema,
  posterFrame: z.int().min(0),
  defaultRenderProfileId: profileId,
  tags: z.array(slug).max(30),
});

export const MAX_DOCUMENT_BYTES = 512 * 1024;

export const documentSaveInputSchema = z.strictObject({
  content: z
    .string()
    .refine(
      (value) => new TextEncoder().encode(value).byteLength <= MAX_DOCUMENT_BYTES,
      `Documents are limited to ${MAX_DOCUMENT_BYTES / 1024} KB`,
    ),
  /** SHA-256 of the content the editor started from. */
  baseHash: z.string().regex(/^[a-f0-9]{64}$/),
});

export const archiveInputSchema = z.strictObject({
  /** The operator must type the record's slug to confirm. */
  confirmSlug: z.string(),
});

/** Asset folders: project `assets/`, project `brand/assets/`, campaign `assets/`, production `assets/`. */
export const assetScope = z.enum(["project", "brand", "campaign", "production"]);
export type AssetScope = z.infer<typeof assetScope>;

const optionalMetadata = (max: number) => z.string().trim().max(max).optional();

export const assetMetadataInputSchema = z.strictObject({
  /** SHA-256 of the sidecar file the editor loaded. */
  baseHash: z.string().regex(/^[a-f0-9]{64}$/),
  altText: optionalMetadata(1000),
  source: optionalMetadata(1000),
  licenceNotes: optionalMetadata(2000),
});

export const assetRegisterInputSchema = z.strictObject({ fileName: z.string().min(1).max(255) });

export const assetArchiveInputSchema = z.strictObject({
  /** The operator must type the stored file name to confirm. */
  confirmName: z.string(),
});

export const scope = z.enum(["project", "campaign", "production"]);
export type Scope = z.infer<typeof scope>;

/** Allowlisted Markdown documents per scope. Keys are URL-safe kinds; values are paths inside the record folder. */
export const DOCUMENTS = {
  project: { context: "context.md", brand: "brand/brand.md" },
  campaign: { brief: "brief.md" },
  production: { brief: "brief.md", prompt: "prompt.md", notes: "notes.md" },
} as const satisfies Record<Scope, Record<string, string>>;

export type DocumentKind<S extends Scope = Scope> = keyof (typeof DOCUMENTS)[S] & string;

export function documentPath(scopeName: Scope, kind: string): string | undefined {
  const documents: Record<string, string> = DOCUMENTS[scopeName];
  return Object.hasOwn(documents, kind) ? documents[kind] : undefined;
}

export type ProjectCreateInput = z.input<typeof projectCreateInputSchema>;
export type ProjectUpdateInput = z.infer<typeof projectUpdateInputSchema>;
export type CampaignCreateInput = z.input<typeof campaignCreateInputSchema>;
export type CampaignUpdateInput = z.infer<typeof campaignUpdateInputSchema>;
export type ProductionCreateInput = z.input<typeof productionCreateInputSchema>;
export type ProductionUpdateInput = z.infer<typeof productionUpdateInputSchema>;
export type DocumentSaveInput = z.infer<typeof documentSaveInputSchema>;
export type AssetMetadataInput = z.infer<typeof assetMetadataInputSchema>;
