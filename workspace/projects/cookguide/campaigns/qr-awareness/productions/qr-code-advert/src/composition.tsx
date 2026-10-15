import { assertHttpsUrl, type MotionStudioComposition } from "@motion-studio/motion-runtime";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { useInter } from "./fonts.ts";
import { Background } from "./scenes/Background.tsx";
import { CallToAction } from "./scenes/CallToAction.tsx";
import { Hook } from "./scenes/Hook.tsx";
import { Logo } from "./scenes/Logo.tsx";
import { Phone } from "./scenes/Phone.tsx";
import { DESIGN_WIDTH, LAST_ANIMATED_FRAME } from "./theme.ts";

type Props = {
  /** QR destination. Set in props.json; never hard-coded here. */
  qrUrl: string;
};

/**
 * CookGuide QR advert, 12 s portrait. See ../brief.md for the scene plan.
 * All motion derives from the frame, clamped at frame 269 so the call to
 * action (frames 270–359) is completely static.
 */
function CookGuideQrAdvert({ qrUrl }: Props) {
  const url = assertHttpsUrl(qrUrl, "props.qrUrl");
  const frame = Math.min(useCurrentFrame(), LAST_ANIMATED_FRAME);
  const { width } = useVideoConfig();
  const u = width / DESIGN_WIDTH;
  useInter();

  return (
    <AbsoluteFill>
      <Background frame={frame} u={u} />
      <Logo u={u} />
      <Hook frame={frame} u={u} />
      <Phone frame={frame} u={u} />
      <CallToAction frame={frame} u={u} qrUrl={url} />
    </AbsoluteFill>
  );
}

export const composition: MotionStudioComposition<Props> = {
  id: "cookguide-qr-code-advert",
  Component: CookGuideQrAdvert,
  // Deliberately empty: the destination must come from props.json, and the
  // composition refuses to render without it.
  defaultProps: { qrUrl: "" },
};
