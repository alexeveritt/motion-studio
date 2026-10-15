import { z } from "zod";
import {
  nonEmptyText,
  optionalText,
  recordId,
  revision,
  schemaVersion,
  slug,
  textList,
  timestamp,
} from "./common.ts";

export const campaignStatus = z.enum(["draft", "active", "complete", "archived"]);

export const campaignRecordSchema = z.strictObject({
  schemaVersion,
  id: recordId,
  projectId: recordId,
  slug,
  name: nonEmptyText(120),
  description: optionalText(2000),
  objective: optionalText(2000),
  audience: textList,
  keyMessages: textList,
  channels: textList,
  status: campaignStatus,
  briefFile: z.literal("brief.md"),
  createdAt: timestamp,
  updatedAt: timestamp,
  revision,
});

export type CampaignRecord = z.infer<typeof campaignRecordSchema>;
