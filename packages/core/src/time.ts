/**
 * Frame and timecode helpers. `durationInFrames` is authoritative; seconds are
 * derived and rounded only for display.
 */

export function framesToSeconds(frames: number, fps: number): number {
  assertPositiveInteger(fps, "fps");
  return frames / fps;
}

/** Human label such as "12s" or "2.5s". */
export function formatDurationLabel(frames: number, fps: number): string {
  const seconds = framesToSeconds(frames, fps);
  const rounded = Math.round(seconds * 100) / 100;
  return `${rounded}s`;
}

/** SMPTE-style non-drop-frame timecode: HH:MM:SS:FF. */
export function formatTimecode(frame: number, fps: number): string {
  assertPositiveInteger(fps, "fps");
  if (!Number.isInteger(frame) || frame < 0) {
    throw new RangeError("frame must be a non-negative integer");
  }
  const ff = frame % fps;
  const totalSeconds = Math.floor(frame / fps);
  const ss = totalSeconds % 60;
  const mm = Math.floor(totalSeconds / 60) % 60;
  const hh = Math.floor(totalSeconds / 3600);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff, String(fps - 1).length)}`;
}

/** Inverse of formatTimecode. */
export function parseTimecode(timecode: string, fps: number): number {
  assertPositiveInteger(fps, "fps");
  const match = /^(\d{2,}):([0-5]\d):([0-5]\d):(\d{2,})$/.exec(timecode);
  if (!match) throw new RangeError(`Invalid timecode "${timecode}"`);
  const [, hh, mm, ss, ff] = match.map(Number) as [number, number, number, number, number];
  if (ff >= fps) throw new RangeError(`Frame component ${ff} exceeds fps ${fps}`);
  return ((hh * 60 + mm) * 60 + ss) * fps + ff;
}

/** Clamp a requested frame to the valid range [0, durationInFrames - 1]. */
export function clampFrame(frame: number, durationInFrames: number): number {
  if (durationInFrames <= 0) return 0;
  return Math.min(Math.max(Math.round(frame), 0), durationInFrames - 1);
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`);
  }
}
