import { describe, expect, it } from "vitest";
import { detectMedia, svgProblems } from "../src/media.ts";
import {
  CLEAN_SVG,
  gifHeader,
  jpegHeader,
  makePng,
  PDF,
  webpVp8xHeader,
} from "./media-fixtures.ts";

const ascii = (text: string) => new Uint8Array(Buffer.from(text, "latin1"));

describe("detectMedia", () => {
  it.each([
    [
      "PNG",
      makePng(320, 180),
      { mimeType: "image/png", extension: "png", width: 320, height: 180 },
    ],
    [
      "JPEG",
      jpegHeader(1080, 1920),
      { mimeType: "image/jpeg", extension: "jpg", width: 1080, height: 1920 },
    ],
    ["GIF", gifHeader(64, 32), { mimeType: "image/gif", extension: "gif", width: 64, height: 32 }],
    [
      "WebP",
      webpVp8xHeader(500, 400),
      { mimeType: "image/webp", extension: "webp", width: 500, height: 400 },
    ],
    [
      "SVG",
      Buffer.from(CLEAN_SVG),
      { mimeType: "image/svg+xml", extension: "svg", width: 240, height: 80 },
    ],
    ["PDF", PDF, { mediaType: "document", mimeType: "application/pdf", extension: "pdf" }],
    [
      "WAV",
      ascii("RIFF\u0000\u0000\u0000\u0000WAVEfmt "),
      { mediaType: "audio", extension: "wav" },
    ],
    ["MP3", ascii("ID3\u0004\u0000"), { mediaType: "audio", extension: "mp3" }],
    ["OGG", ascii("OggS\u0000\u0002"), { mediaType: "audio", extension: "ogg" }],
    [
      "M4A",
      ascii("\u0000\u0000\u0000\u0020ftypM4A \u0000"),
      { mediaType: "audio", extension: "m4a" },
    ],
    [
      "MP4",
      ascii("\u0000\u0000\u0000\u0020ftypisom\u0000"),
      { mediaType: "video", extension: "mp4" },
    ],
    [
      "MOV",
      ascii("\u0000\u0000\u0000\u0014ftypqt  \u0000"),
      { mediaType: "video", extension: "mov" },
    ],
    [
      "WebM",
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]),
      { mediaType: "video", extension: "webm" },
    ],
    ["WOFF2", ascii("wOF2\u0000\u0001"), { mediaType: "font", extension: "woff2" }],
    ["OTF", ascii("OTTO\u0000\u000b"), { mediaType: "font", extension: "otf" }],
  ])("detects %s from bytes regardless of the name", (_label, bytes, expected) => {
    expect(detectMedia(new Uint8Array(bytes), "misleading-name.exe")).toMatchObject(expected);
  });

  it("uses the name only for plain text, which has no signature", () => {
    expect(detectMedia(ascii("# Notes\n"), "notes.md")).toMatchObject({
      mimeType: "text/markdown",
      extension: "md",
    });
    expect(detectMedia(ascii("hello"), "readme.txt")).toMatchObject({ mimeType: "text/plain" });
    expect(detectMedia(ascii("echo hi"), "run.sh")).toBeUndefined();
  });

  it.each([
    ["executable", Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03])],
    ["zip", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14])],
    ["random binary", Buffer.from([0x13, 0x37, 0x00, 0xfe, 0xed])],
    ["html", Buffer.from("<!doctype html><script>alert(1)</script>")],
  ])("rejects %s", (_label, bytes) => {
    expect(detectMedia(new Uint8Array(bytes), "file.png")).toBeUndefined();
  });
});

describe("svgProblems", () => {
  it("accepts a plain SVG", () => {
    expect(svgProblems(CLEAN_SVG)).toEqual([]);
    expect(svgProblems('<svg><use href="#shape"/><path fill="url(#grad)"/></svg>')).toEqual([]);
  });

  it.each([
    ["<svg><script>alert(1)</script></svg>", "<script>"],
    ['<svg onload="alert(1)"></svg>', "event handler"],
    ['<svg><a href="javascript:alert(1)">x</a></svg>', "javascript:"],
    ["<svg><foreignObject><div/></foreignObject></svg>", "foreignObject"],
    ['<svg><image href="https://tracker.example/x.png"/></svg>', "external resource"],
    ["<svg><style>@import url(https://x.example/a.css);</style></svg>", "imports external CSS"],
    ['<!DOCTYPE svg [<!ENTITY x "y">]><svg>&x;</svg>', "entities"],
  ])("flags %s", (svg, problem) => {
    expect(svgProblems(svg).join(" ")).toContain(problem);
  });
});
