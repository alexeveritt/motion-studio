import { formatDurationLabel } from "./time.ts";
import type { CampaignRecord } from "./schemas/campaign.ts";
import type { ProductionRecord } from "./schemas/production.ts";
import type { ProjectRecord } from "./schemas/project.ts";

/** Starter Markdown written when records are created. Operators edit these freely afterwards. */

export function projectContextTemplate(project: ProjectRecord): string {
  return `# ${project.name} context

Describe the product so that someone who has never seen the studio can work from this file alone.

## Product

## Audience

## Terminology

## Claims that may be made

## Claims that must not be made

## Tone

## Brand constraints

## Source repository
${project.sourceRepository ? `\`${project.sourceRepository.path}\` (informational only)` : "None recorded."}
`;
}

export function brandTemplate(project: ProjectRecord): string {
  return `# ${project.name} brand

## Logo usage

## Colours

## Typography

## Imagery
`;
}

export function campaignBriefTemplate(campaign: CampaignRecord): string {
  return `# ${campaign.name}

## Objective
${campaign.objective || ""}

## Audience
${campaign.audience.map((item) => `- ${item}`).join("\n")}

## Key messages
${campaign.keyMessages.map((item) => `- ${item}`).join("\n")}

## Channels
${campaign.channels.map((item) => `- ${item}`).join("\n")}
`;
}

/** Production brief with the required structure from spec section 8.2. */
export function productionBriefTemplate(production: ProductionRecord): string {
  const { width, height, fps, durationInFrames } = production.format;
  return `# ${production.title}

## Objective

## Audience

## Single key message

## Call to action

## Format and duration
${width} × ${height}, ${fps} fps, ${durationInFrames} frames (${formatDurationLabel(durationInFrames, fps)}).

## Narrative and scenes

## Required content

## Prohibited content

## Visual direction

## Audio direction

## Accessibility

## Deliverables

## Acceptance criteria
`;
}

export function productionPromptTemplate(
  project: ProjectRecord,
  campaign: CampaignRecord,
  production: ProductionRecord,
): string {
  return `# Implement ${production.title}

Implement the Remotion composition for this production.

- Project: ${project.name}
- Campaign: ${campaign.name}
- Composition ID: \`${production.compositionId}\`
- Entry file: \`${production.files.entry}\`

Read \`brief.md\` in this folder and the project \`context.md\` before starting. Keep all production-specific code inside this production folder. Do not commit or push.
`;
}

export function productionNotesTemplate(production: ProductionRecord): string {
  return `# ${production.title} notes\n`;
}
