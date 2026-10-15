import { QrCode, qrMatrix } from "@motion-studio/motion-runtime";
import { mix, ramp } from "../motion.ts";
import { COLOURS, FONT } from "../theme.ts";

const QUIET_ZONE = 4;

/**
 * Frames 200–359: the white action card grows in, the QR code and copy fade
 * in, and everything is at rest by frame 265. Callers pass a frame clamped
 * to 269, so frames 270–359 are pixel-identical.
 */
export function CallToAction({ frame, u, qrUrl }: { frame: number; u: number; qrUrl: string }) {
  const card = ramp(frame, 200, 248);
  if (card <= 0) return null;
  const content = ramp(frame, 236, 262);

  // Snap the QR to whole pixels per module so every module renders crisply.
  const modules = qrMatrix(qrUrl).length + QUIET_ZONE * 2;
  const qrSize = Math.floor((700 * u) / modules) * modules;
  const cardSize = 780 * u;
  const display = qrUrl.replace(/^https:\/\//, "").replace(/\/$/, "");

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 350 * u,
          left: 80 * u,
          right: 80 * u,
          textAlign: "center",
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 84 * u,
          letterSpacing: -1.5 * u,
          color: COLOURS.ink,
          opacity: content,
        }}
      >
        Scan to start cooking
      </div>
      <div
        style={{
          position: "absolute",
          left: (1080 * u - cardSize) / 2,
          top: 520 * u,
          width: cardSize,
          height: cardSize,
          borderRadius: 48 * u,
          background: COLOURS.white,
          boxShadow: `0 ${24 * u}px ${70 * u}px rgba(29, 27, 22, 0.18)`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: card,
          transform: `scale(${mix(0.6, 1, card)})`,
        }}
      >
        <div style={{ opacity: content }}>
          <QrCode
            value={qrUrl}
            size={qrSize}
            quietZone={QUIET_ZONE}
            foreground={COLOURS.black}
            background={COLOURS.white}
            title="Scan to open CookGuide"
          />
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          top: 1350 * u,
          left: 80 * u,
          right: 80 * u,
          textAlign: "center",
          fontFamily: FONT,
          color: COLOURS.ink,
          opacity: content,
        }}
      >
        <div style={{ fontWeight: 600, fontSize: 44 * u }}>Point your phone camera at the code</div>
        <div style={{ fontWeight: 400, fontSize: 38 * u, marginTop: 14 * u, color: COLOURS.herb }}>
          {display}
        </div>
      </div>
    </>
  );
}
