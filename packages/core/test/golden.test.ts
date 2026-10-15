import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import { compareImages, goldenConfigSchema } from "../src/golden.ts";

function image(
  width: number,
  height: number,
  paint: (x: number, y: number) => [number, number, number],
): PNG {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      png.data.set([r, g, b, 255], (y * width + x) * 4);
    }
  }
  return png;
}

const tolerance = { channelThreshold: 16, maxDifferentRatio: 0.002 };

describe("compareImages", () => {
  const base = image(100, 100, (x) => [x * 2, 100, 200]);

  it("passes identical images", () => {
    expect(
      compareImages(
        base,
        image(100, 100, (x) => [x * 2, 100, 200]),
        tolerance,
      ),
    ).toMatchObject({
      pass: true,
      differentPixels: 0,
      maxChannelDelta: 0,
    });
  });

  it("absorbs small anti-aliasing noise below the channel threshold", () => {
    const noisy = image(100, 100, (x, y) => [x * 2 + ((x + y) % 3), 100, 200 - (y % 5)]);
    expect(compareImages(base, noisy, tolerance)).toMatchObject({ pass: true, differentPixels: 0 });
  });

  it("allows a tiny share of differing pixels but fails a visible change", () => {
    const speck = image(100, 100, (x, y) => (x === 5 && y === 5 ? [255, 0, 0] : [x * 2, 100, 200]));
    expect(compareImages(base, speck, tolerance)).toMatchObject({ pass: true, differentPixels: 1 });

    const changed = image(100, 100, (x, y) => (x < 20 && y < 20 ? [255, 0, 0] : [x * 2, 100, 200]));
    const result = compareImages(base, changed, tolerance);
    expect(result).toMatchObject({ pass: false, differentPixels: 400, differentRatio: 0.04 });
    expect(result.diff?.data.slice(0, 4)).toEqual(Buffer.from([255, 0, 0, 255]));
  });

  it("fails images of different sizes", () => {
    expect(
      compareImages(
        base,
        image(100, 90, () => [0, 0, 0]),
        tolerance,
      ),
    ).toMatchObject({ pass: false, sameSize: false });
  });
});

describe("goldenConfigSchema", () => {
  it("fills in documented defaults", () => {
    expect(goldenConfigSchema.parse({ frames: [0, 59] })).toEqual({
      frames: [0, 59],
      profileId: "standard",
      tolerance: { channelThreshold: 16, maxDifferentRatio: 0.002 },
    });
  });

  it("rejects an empty frame list", () => {
    expect(goldenConfigSchema.safeParse({ frames: [] }).success).toBe(false);
  });
});
