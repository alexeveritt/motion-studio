import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { assertHttpsUrl, qrMatrix } from "../src/QrCode.tsx";

/** Rasterise a matrix with a quiet zone into RGBA pixels, the way a camera would see it. */
function rasterise(matrix: boolean[][], moduleSize = 8, quietZone = 4) {
  const modules = matrix.length + quietZone * 2;
  const size = modules * moduleSize;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const row = Math.floor(y / moduleSize) - quietZone;
      const col = Math.floor(x / moduleSize) - quietZone;
      if (matrix[row]?.[col]) data.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
    }
  }
  return { data, size };
}

describe("qrMatrix", () => {
  it.each([
    "https://cookguide.example/start",
    "https://cookguide.example/start?utm_source=qr&utm_campaign=awareness",
    "https://example.com/a%20b",
  ])("encodes %s so a decoder reads it back exactly", (value) => {
    const { data, size } = rasterise(qrMatrix(value));
    expect(jsQR(data, size, size)?.data).toBe(value);
  });

  it("is deterministic", () => {
    expect(qrMatrix("https://cookguide.example/start")).toEqual(
      qrMatrix("https://cookguide.example/start"),
    );
  });

  it.each(["", "https://café.example", "line\nbreak", "x".repeat(1001)])("rejects %j", (value) => {
    expect(() => qrMatrix(value)).toThrow("printable ASCII");
  });
});

describe("assertHttpsUrl", () => {
  it("accepts https URLs", () => {
    expect(assertHttpsUrl("https://cookguide.example/start", "qrUrl")).toBe(
      "https://cookguide.example/start",
    );
  });

  it.each([
    [undefined, "qrUrl is missing"],
    ["", "qrUrl is missing"],
    ["not a url", "not a valid URL"],
    ["http://cookguide.example", "must be an https:// URL"],
    ["javascript:alert(1)", "must be an https:// URL"],
  ])("rejects %j", (value, message) => {
    expect(() => assertHttpsUrl(value, "qrUrl")).toThrow(message);
  });
});
