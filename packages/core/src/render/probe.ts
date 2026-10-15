import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { MotionStudioError } from "../errors.ts";

const run = promisify(execFile);

export type VideoProbe = {
  codec: string;
  pixelFormat: string;
  width: number;
  height: number;
  fps: number;
  /** Decoded frame count (ffprobe -count_frames), not an estimate from the container. */
  frames: number;
  durationSeconds: number;
  hasAudio: boolean;
};

export type ImageProbe = { codec: string; width: number; height: number };

/**
 * Location of the ffprobe binary that ships with the pinned Remotion version.
 * RenderInternals is not public API; the exact Remotion pin keeps it stable,
 * and this is the only place it is used.
 */
async function ffprobe(): Promise<{ bin: string; dir: string }> {
  try {
    const { RenderInternals } = await import("@remotion/renderer");
    const bin = RenderInternals.getExecutablePath({
      type: "ffprobe",
      indent: false,
      logLevel: "error",
      binariesDirectory: null,
    });
    return { bin, dir: path.dirname(bin) };
  } catch (error) {
    throw new MotionStudioError("TOOLING", "Could not locate ffprobe from @remotion/renderer", {
      cause: error,
    });
  }
}

/** Run ffprobe without a shell, with only its own library path in the environment. */
async function probeJson(file: string, args: string[]): Promise<Record<string, unknown>> {
  const { bin, dir } = await ffprobe();
  try {
    const { stdout } = await run(bin, ["-v", "error", ...args, "-of", "json", file], {
      cwd: dir,
      env: { DYLD_LIBRARY_PATH: dir, LD_LIBRARY_PATH: dir },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
    });
    return JSON.parse(stdout) as Record<string, unknown>;
  } catch (error) {
    throw new MotionStudioError(
      "VIDEO_VALIDATION_FAILED",
      `ffprobe could not read ${path.basename(file)}`,
      { cause: error },
    );
  }
}

type Stream = Record<string, string | number | undefined>;

export async function probeVideo(file: string): Promise<VideoProbe> {
  const data = await probeJson(file, ["-count_frames", "-show_streams", "-show_format"]);
  const streams = (data.streams ?? []) as Stream[];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video)
    throw new MotionStudioError("VIDEO_VALIDATION_FAILED", "The output has no video stream");
  const format = (data.format ?? {}) as Stream;
  return {
    codec: String(video.codec_name),
    pixelFormat: String(video.pix_fmt),
    width: Number(video.width),
    height: Number(video.height),
    fps: parseRate(String(video.avg_frame_rate ?? video.r_frame_rate)),
    frames: Number(video.nb_read_frames ?? video.nb_frames),
    durationSeconds: Number(format.duration ?? video.duration),
    hasAudio: streams.some((stream) => stream.codec_type === "audio"),
  };
}

export async function probeImage(file: string): Promise<ImageProbe> {
  const data = await probeJson(file, ["-show_streams"]);
  const stream = ((data.streams ?? []) as Stream[])[0];
  if (!stream)
    throw new MotionStudioError("VIDEO_VALIDATION_FAILED", "The image could not be read");
  return {
    codec: String(stream.codec_name),
    width: Number(stream.width),
    height: Number(stream.height),
  };
}

/** Whether ffprobe can read an audio or video asset at all. */
export async function canProbe(file: string): Promise<boolean> {
  try {
    const data = await probeJson(file, ["-show_streams"]);
    return Array.isArray(data.streams) && data.streams.length > 0;
  } catch {
    return false;
  }
}

function parseRate(rate: string): number {
  const [num, den] = rate.split("/").map(Number);
  return den ? (num ?? 0) / den : Number(num);
}

export type ExpectedVideo = {
  codec: "h264";
  pixelFormat: "yuv420p";
  width: number;
  height: number;
  fps: number;
  frames: number;
};

/** Compare a probe with what was configured. Returns human-readable problems; empty means valid. */
export function videoProblems(expected: ExpectedVideo, probe: VideoProbe): string[] {
  const problems: string[] = [];
  if (probe.codec !== expected.codec)
    problems.push(`codec is ${probe.codec}, expected ${expected.codec}`);
  if (probe.pixelFormat !== expected.pixelFormat)
    problems.push(`pixel format is ${probe.pixelFormat}, expected ${expected.pixelFormat}`);
  if (probe.width !== expected.width || probe.height !== expected.height) {
    problems.push(
      `size is ${probe.width}×${probe.height}, expected ${expected.width}×${expected.height}`,
    );
  }
  if (Math.abs(probe.fps - expected.fps) > 0.01)
    problems.push(`frame rate is ${probe.fps}, expected ${expected.fps}`);
  if (probe.frames !== expected.frames)
    problems.push(`contains ${probe.frames} frames, expected exactly ${expected.frames}`);
  const expectedSeconds = expected.frames / expected.fps;
  if (Math.abs(probe.durationSeconds - expectedSeconds) > 1.5 / expected.fps) {
    problems.push(
      `duration is ${probe.durationSeconds.toFixed(3)} s, expected ${expectedSeconds.toFixed(3)} s`,
    );
  }
  return problems;
}
