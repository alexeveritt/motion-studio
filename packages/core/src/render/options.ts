import type { ProductionFormat } from "../schemas/production.ts";
import type { RenderProfile } from "../schemas/render-profile.ts";

/** Options passed to Remotion's renderMedia for a profile. Kept pure so it can be unit-tested. */
export type MediaRenderOptions = {
  codec: "h264";
  crf: number;
  pixelFormat: "yuv420p";
  imageFormat: "jpeg" | "png";
  jpegQuality?: number;
  scale: number;
  audioCodec: "aac";
  audioBitrate: `${number}k`;
  concurrency: number;
  muted: boolean;
  enforceAudioTrack: false;
  /** Fail instead of silently falling back if something is not what we asked for. */
  overwrite: false;
};

export function mediaRenderOptions(profile: RenderProfile): MediaRenderOptions {
  return {
    codec: profile.codec,
    crf: profile.crf,
    pixelFormat: profile.pixelFormat,
    imageFormat: profile.imageFormat,
    ...(profile.imageFormat === "jpeg" ? { jpegQuality: 90 } : {}),
    scale: profile.scale ?? 1,
    audioCodec: profile.audioCodec,
    // The profile schema only accepts values like "192k".
    audioBitrate: profile.audioBitrate as `${number}k`,
    concurrency: profile.concurrency,
    muted: profile.muted ?? false,
    enforceAudioTrack: false,
    overwrite: false,
  };
}

/** Pixel size of the encoded output for a format and profile. */
export function outputSize(
  format: ProductionFormat,
  profile: RenderProfile,
): { width: number; height: number } {
  const scale = profile.scale ?? 1;
  return { width: Math.round(format.width * scale), height: Math.round(format.height * scale) };
}

/** Frames rendered as a smoke test before the full render: start, quarters, end and poster. */
export function sampleFrames(durationInFrames: number, posterFrame: number): number[] {
  const last = durationInFrames - 1;
  const frames = [
    0,
    Math.floor(last * 0.25),
    Math.floor(last * 0.5),
    Math.floor(last * 0.75),
    last,
    posterFrame,
  ];
  return [...new Set(frames.filter((frame) => frame >= 0 && frame <= last))].sort((a, b) => a - b);
}
