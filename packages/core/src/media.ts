import type { AssetRecord } from "./schemas/asset.ts";

/**
 * File type detection from content. The browser-supplied type and the file
 * extension are never trusted: the stored extension is derived from the bytes.
 */

export type DetectedMedia = {
  mediaType: AssetRecord["mediaType"];
  mimeType: string;
  /** Canonical extension without the dot. */
  extension: string;
  width?: number;
  height?: number;
};

/** Bytes to read from the start of a file for detection and dimension parsing. */
export const SNIFF_BYTES = 512 * 1024;

/** SVGs are parsed as text in full, so they get a tighter limit. */
export const MAX_SVG_BYTES = 5 * 1024 * 1024;

const TEXT_EXTENSIONS: Record<string, { mimeType: string; extension: string }> = {
  txt: { mimeType: "text/plain", extension: "txt" },
  md: { mimeType: "text/markdown", extension: "md" },
  markdown: { mimeType: "text/markdown", extension: "md" },
};

/**
 * Identify a file from its leading bytes. `originalName` is consulted only
 * for plain text, which has no signature. Returns undefined for anything not
 * on the allowlist.
 */
export function detectMedia(head: Uint8Array, originalName: string): DetectedMedia | undefined {
  const ascii = (start: number, end: number) => String.fromCharCode(...head.subarray(start, end));
  const starts = (...bytes: number[]) => bytes.every((byte, i) => head[i] === byte);

  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { mediaType: "image", mimeType: "image/png", extension: "png", ...pngSize(head) };
  }
  if (starts(0xff, 0xd8, 0xff)) {
    return { mediaType: "image", mimeType: "image/jpeg", extension: "jpg", ...jpegSize(head) };
  }
  if (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a") {
    return { mediaType: "image", mimeType: "image/gif", extension: "gif", ...gifSize(head) };
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") {
    return { mediaType: "image", mimeType: "image/webp", extension: "webp", ...webpSize(head) };
  }
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") {
    return { mediaType: "audio", mimeType: "audio/wav", extension: "wav" };
  }
  if (ascii(0, 4) === "OggS")
    return { mediaType: "audio", mimeType: "audio/ogg", extension: "ogg" };
  if (
    ascii(0, 3) === "ID3" ||
    (head[0] === 0xff && head[1] !== undefined && (head[1] & 0xe6) === 0xe2)
  ) {
    return { mediaType: "audio", mimeType: "audio/mpeg", extension: "mp3" };
  }
  if (ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "M4A " || brand === "M4B ")
      return { mediaType: "audio", mimeType: "audio/mp4", extension: "m4a" };
    if (brand === "qt  ")
      return { mediaType: "video", mimeType: "video/quicktime", extension: "mov" };
    return { mediaType: "video", mimeType: "video/mp4", extension: "mp4" };
  }
  if (starts(0x1a, 0x45, 0xdf, 0xa3))
    return { mediaType: "video", mimeType: "video/webm", extension: "webm" };
  if (ascii(0, 4) === "wOF2")
    return { mediaType: "font", mimeType: "font/woff2", extension: "woff2" };
  if (ascii(0, 4) === "wOFF")
    return { mediaType: "font", mimeType: "font/woff", extension: "woff" };
  if (ascii(0, 4) === "OTTO") return { mediaType: "font", mimeType: "font/otf", extension: "otf" };
  if (starts(0x00, 0x01, 0x00, 0x00) || ascii(0, 4) === "true") {
    return { mediaType: "font", mimeType: "font/ttf", extension: "ttf" };
  }
  if (ascii(0, 5) === "%PDF-")
    return { mediaType: "document", mimeType: "application/pdf", extension: "pdf" };

  const text = decodeUtf8(head);
  if (text === undefined) return undefined;
  if (looksLikeSvg(text))
    return { mediaType: "image", mimeType: "image/svg+xml", extension: "svg", ...svgSize(text) };
  const declared = TEXT_EXTENSIONS[extensionOf(originalName)];
  if (declared) return { mediaType: "document", ...declared };
  return undefined;
}

/** Human-readable byte size, binary units. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function stripExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Reject SVGs that could run script or load anything external. Uploaded SVGs
 * are only ever shown through <img> or as data, but they also end up inside
 * compositions, so they must be inert on their own.
 */
export function svgProblems(svg: string): string[] {
  const problems: string[] = [];
  const lower = svg.toLowerCase();
  if (/<script[\s>/]/.test(lower)) problems.push("contains a <script> element");
  if (/<foreignobject[\s>/]/.test(lower)) problems.push("contains a <foreignObject> element");
  if (/\son[a-z]+\s*=/.test(lower)) problems.push("contains event handler attributes");
  if (/javascript:/.test(lower)) problems.push("contains a javascript: URL");
  if (/<!entity/.test(lower)) problems.push("declares XML entities");
  if (/(?:href|src)\s*=\s*["']\s*(?!#|data:image\/(?:png|jpeg|gif|webp);base64,)/.test(lower)) {
    problems.push("references an external resource");
  }
  if (/url\(\s*["']?\s*(?!#|data:image\/(?:png|jpeg|gif|webp);base64,)/.test(lower)) {
    problems.push("references an external resource in CSS");
  }
  if (/@import/.test(lower)) problems.push("imports external CSS");
  return problems;
}

// ------------------------------------------------------------- dimensions

type Size = { width?: number; height?: number };

function size(width: number, height: number): Size {
  return width > 0 && height > 0 ? { width, height } : {};
}

function view(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function pngSize(head: Uint8Array): Size {
  if (head.length < 24) return {};
  const data = view(head);
  return size(data.getUint32(16), data.getUint32(20));
}

function gifSize(head: Uint8Array): Size {
  if (head.length < 10) return {};
  const data = view(head);
  return size(data.getUint16(6, true), data.getUint16(8, true));
}

function jpegSize(head: Uint8Array): Size {
  const data = view(head);
  let offset = 2;
  while (offset + 9 < head.length) {
    if (head[offset] !== 0xff) return {};
    const marker = head[offset + 1]!;
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // SOF0-SOF15 excluding DHT (C4), JPG (C8) and DAC (CC) carry the frame size.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return size(data.getUint16(offset + 7), data.getUint16(offset + 5));
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    offset += 2 + data.getUint16(offset + 2);
  }
  return {};
}

function webpSize(head: Uint8Array): Size {
  if (head.length < 30) return {};
  const data = view(head);
  const chunk = String.fromCharCode(...head.subarray(12, 16));
  if (chunk === "VP8X") {
    const read24 = (at: number) => head[at]! | (head[at + 1]! << 8) | (head[at + 2]! << 16);
    return size(read24(24) + 1, read24(27) + 1);
  }
  if (chunk === "VP8L") {
    const bits = data.getUint32(21, true);
    return size((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
  }
  if (chunk === "VP8 ") {
    return size(data.getUint16(26, true) & 0x3fff, data.getUint16(28, true) & 0x3fff);
  }
  return {};
}

function svgSize(text: string): Size {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) return {};
  const attribute = (name: string) =>
    new RegExp(`\\s${name}\\s*=\\s*["']\\s*([\\d.]+)\\s*(px)?\\s*["']`, "i").exec(tag)?.[1];
  const width = Number(attribute("width"));
  const height = Number(attribute("height"));
  if (width > 0 && height > 0) return size(Math.round(width), Math.round(height));
  const viewBox =
    /\sviewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*["']/i.exec(tag);
  return viewBox ? size(Math.round(Number(viewBox[1])), Math.round(Number(viewBox[2]))) : {};
}

function looksLikeSvg(text: string): boolean {
  const trimmed = text
    .replace(/^\uFEFF/, "")
    .replace(/^\s*<\?xml[^>]*\?>/i, "")
    .replace(/^(\s*<!--[\s\S]*?-->)*/, "")
    .replace(/^\s*<!doctype svg[^>]*>/i, "")
    .replace(/^(\s*<!--[\s\S]*?-->)*/, "")
    .trimStart();
  return /^<svg[\s>]/i.test(trimmed);
}

/** Decode as UTF-8, or undefined for binary content (invalid UTF-8 or NUL bytes). */
function decodeUtf8(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  // A multi-byte character may be cut at the sniff boundary; allow up to 3 trailing bytes to be dropped.
  for (let trim = 0; trim <= 3 && trim < bytes.length; trim++) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(0, bytes.length - trim),
      );
    } catch {
      // Try a shorter slice.
    }
  }
  return undefined;
}
