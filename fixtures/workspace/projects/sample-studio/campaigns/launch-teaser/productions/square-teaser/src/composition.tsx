import type { MotionStudioComposition } from "@motion-studio/motion-runtime";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

type Props = { headline: string };

/**
 * Placeholder created by Motion Studio. Replace it with the composition
 * described in ../brief.md. Derive everything from the current frame and
 * props; load fonts and images from assets with useAsset() and useLocalFont().
 */
function Placeholder({ headline }: Props) {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const unit = Math.min(width, height) / 100;
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const progress = frame / Math.max(1, durationInFrames - 1);

  return (
    <AbsoluteFill
      style={{
        background: "#14161a",
        color: "#f4f4f2",
        // System fonts are fine for a placeholder; real compositions load local font files.
        fontFamily: "system-ui, sans-serif",
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <div
        style={{
          opacity: enter,
          transform: `translateY(${interpolate(enter, [0, 1], [4 * unit, 0])}px)`,
          textAlign: "center",
          padding: 8 * unit,
        }}
      >
        <div style={{ fontSize: 7 * unit, fontWeight: 700 }}>{headline}</div>
        <div style={{ fontSize: 3 * unit, opacity: 0.7, marginTop: 2 * unit }}>
          {width} × {height} · {fps} fps · frame {frame} of {durationInFrames - 1}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 0,
          bottom: 0,
          height: unit,
          width: `${progress * 100}%`,
          background: "#4f7cff",
        }}
      />
    </AbsoluteFill>
  );
}

export const composition: MotionStudioComposition<Props> = {
  id: "sample-studio-square-teaser",
  Component: Placeholder,
  defaultProps: { headline: "Square Teaser" },
};
