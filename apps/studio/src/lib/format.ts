import { formatDurationLabel, type ProductionRecord } from "@motion-studio/core";

export type Tone = "ok" | "warn" | "error" | "neutral";

const PRODUCTION_TONES: Record<ProductionRecord["status"], Tone> = {
  idea: "neutral",
  briefing: "neutral",
  "in-development": "warn",
  review: "warn",
  approved: "ok",
  archived: "neutral",
};

export function productionTone(status: ProductionRecord["status"]): Tone {
  return PRODUCTION_TONES[status];
}

export function formatSummary({
  width,
  height,
  fps,
  durationInFrames,
}: ProductionRecord["format"]): string {
  return `${width}×${height} · ${fps} fps · ${durationInFrames} frames (${formatDurationLabel(durationInFrames, fps)})`;
}
