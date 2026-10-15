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
  const { width, height, fps, durationInFrames } = production.format;
  return `# Implement ${production.title}

Implement the Remotion composition for **${production.title}** (\`${production.compositionId}\`), part of the ${campaign.name} campaign for ${project.name}.

${width} × ${height}, ${fps} fps, ${durationInFrames} frames (${formatDurationLabel(durationInFrames, fps)}). Poster frame ${production.posterFrame}.

## Before you start

- Print the full context packet: \`pnpm -s context-packet -- ${production.id}\` (also available from the Prompt tab in Motion Studio).
- Read \`brief.md\` in this folder. It is the source of truth for the creative.

## Scope

- Edit only this production folder: \`src/\` and \`tests/\`. The entry file is \`${production.files.entry}\`.
- Use assets by their stored names from this production's \`assets/\` folder or the campaign, project and brand asset folders.
- Keep the composition deterministic: derive all motion from the current frame and props. No network access, clock reads or unseeded randomness.
- Change format, duration or poster frame through Motion Studio rather than editing \`production.json\`.
- Do not commit or push.

## Done when

- The acceptance criteria in \`brief.md\` are met.
- \`pnpm check\` and \`pnpm validate:workspace\` pass.
`;
}

export function productionNotesTemplate(production: ProductionRecord): string {
  return `# ${production.title} notes\n`;
}

/**
 * Placeholder composition written into every new production so it previews
 * immediately. Claude Code replaces it with the real composition.
 */
export function productionCompositionTemplate(production: ProductionRecord): string {
  return `import type { MotionStudioComposition } from "@motion-studio/motion-runtime";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

type Props = { headline: string };

/**
 * Placeholder created by Motion Studio. Replace it with the composition
 * described in ../brief.md. Derive everything from the current frame and
 * props; load fonts and images from assets with useAsset() and useLocalFont().
 * Keep ../props.schema.json in step with the Props type below.
 */
function Placeholder({ headline }: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const unit = Math.min(width, height) / 100;
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const progress = frame / Math.max(1, durationInFrames - 1);

  return (
    <AbsoluteFill
      style={{
        background: "#14161a",
        color: "#f4f4f2",
        // System fonts are fine for a placeholder; real compositions load local font files.
        fontFamily: "system-ui, sans-serif",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          opacity: enter,
          transform: \`translateY(\${interpolate(enter, [0, 1], [4 * unit, 0])}px)\`,
          textAlign: "center",
          padding: 8 * unit,
        }}
      >
        <div style={{ fontSize: 7 * unit, fontWeight: 700 }}>{headline}</div>
        <div style={{ fontSize: 3 * unit, opacity: 0.7, marginTop: 2 * unit }}>
          {width} × {height} · {fps} fps · frame {frame} of {durationInFrames - 1}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          height: unit,
          width: \`\${progress * 100}%\`,
          background: "#4f7cff",
        }}
      />
    </AbsoluteFill>
  );
}

export const composition: MotionStudioComposition<Props> = {
  id: ${JSON.stringify(production.compositionId)},
  Component: Placeholder,
  defaultProps: { headline: ${JSON.stringify(production.title)} },
};
`;
}

/** Props schema matching the placeholder composition's single `headline` prop. */
export function productionPropsSchemaTemplate(production: ProductionRecord): string {
  return `${JSON.stringify(
    {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: `${production.title} props`,
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        headline: {
          type: "string",
          title: "Headline",
          description:
            "Shown by the placeholder composition. Replace this schema when the real composition is written.",
          maxLength: 120,
          default: production.title,
        },
      },
    },
    null,
    2,
  )}\n`;
}
