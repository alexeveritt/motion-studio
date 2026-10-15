import qrcode from "qrcode-generator";

export type QrErrorCorrection = "L" | "M" | "Q" | "H";

const PRINTABLE_ASCII = /^[\x20-\x7e]+$/;

/**
 * Module matrix for a QR code (true = dark). Encoded as bytes in the
 * smallest version that fits. Only printable ASCII is accepted so the
 * payload a scanner reads is exactly the string given.
 */
export function qrMatrix(value: string, level: QrErrorCorrection = "M"): boolean[][] {
  if (!value || value.length > 1000 || !PRINTABLE_ASCII.test(value)) {
    throw new Error(
      "QR value must be 1–1000 printable ASCII characters (percent-encode anything else)",
    );
  }
  const code = qrcode(0, level);
  code.addData(value, "Byte");
  code.make();
  const size = code.getModuleCount();
  return Array.from({ length: size }, (_, row) =>
    Array.from({ length: size }, (_, col) => code.isDark(row, col)),
  );
}

/** Throw a clear error unless `value` is an absolute https:// URL. Use for destination props. */
export function assertHttpsUrl(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} is missing. Set it in the production's props.json.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} is not a valid URL: "${value}"`);
  }
  if (url.protocol !== "https:") throw new Error(`${name} must be an https:// URL, got "${value}"`);
  return value;
}

export type QrCodeProps = {
  value: string;
  /** Rendered width and height in pixels, including the quiet zone. */
  size: number;
  /** Light border in modules. Scanners need at least 4. */
  quietZone?: number;
  level?: QrErrorCorrection;
  foreground?: string;
  background?: string;
  title?: string;
};

/**
 * A static, scannable QR code drawn as one SVG path with crisp edges. The
 * light quiet zone is part of the component so decoration can never crowd it.
 */
export function QrCode({
  value,
  size,
  quietZone = 4,
  level = "M",
  foreground = "#000000",
  background = "#ffffff",
  title,
}: QrCodeProps) {
  if (quietZone < 4) throw new Error("QR quiet zone must be at least 4 modules");
  const matrix = qrMatrix(value, level);
  const total = matrix.length + quietZone * 2;
  let path = "";
  matrix.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x + quietZone} ${y + quietZone}h1v1h-1z`;
    }),
  );
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${total} ${total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={title ?? "QR code"}
      style={{ display: "block" }}
    >
      <rect width={total} height={total} fill={background} />
      <path d={path} fill={foreground} />
    </svg>
  );
}
