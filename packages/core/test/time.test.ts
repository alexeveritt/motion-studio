import { describe, expect, it } from "vitest";
import {
  clampFrame,
  formatDurationLabel,
  formatTimecode,
  framesToSeconds,
  parseTimecode,
} from "../src/time.ts";

describe("frame and timecode conversion", () => {
  it("converts frames to seconds exactly", () => {
    expect(framesToSeconds(360, 30)).toBe(12);
    expect(framesToSeconds(75, 30)).toBe(2.5);
  });

  it("rounds only for display", () => {
    expect(formatDurationLabel(360, 30)).toBe("12s");
    expect(formatDurationLabel(100, 30)).toBe("3.33s");
  });

  it.each([
    [0, 30, "00:00:00:00"],
    [29, 30, "00:00:00:29"],
    [30, 30, "00:00:01:00"],
    [359, 30, "00:00:11:29"],
    [108000, 30, "01:00:00:00"],
    [119, 120, "00:00:00:119"],
  ])("frame %i at %i fps -> %s", (frame, fps, timecode) => {
    expect(formatTimecode(frame, fps)).toBe(timecode);
    expect(parseTimecode(timecode, fps)).toBe(frame);
  });

  it("round-trips every frame of a 12 second advert", () => {
    for (let frame = 0; frame < 360; frame++) {
      expect(parseTimecode(formatTimecode(frame, 30), 30)).toBe(frame);
    }
  });

  it("rejects invalid input", () => {
    expect(() => formatTimecode(-1, 30)).toThrow(RangeError);
    expect(() => formatTimecode(1.5, 30)).toThrow(RangeError);
    expect(() => formatTimecode(0, 0)).toThrow(RangeError);
    expect(() => parseTimecode("00:00:00:30", 30)).toThrow(RangeError);
    expect(() => parseTimecode("bad", 30)).toThrow(RangeError);
  });

  it("clamps frames to the last valid frame, never durationInFrames", () => {
    expect(clampFrame(360, 360)).toBe(359);
    expect(clampFrame(-5, 360)).toBe(0);
    expect(clampFrame(12.4, 360)).toBe(12);
  });
});
