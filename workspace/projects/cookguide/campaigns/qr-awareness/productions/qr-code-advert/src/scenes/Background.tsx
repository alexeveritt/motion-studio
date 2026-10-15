import { AbsoluteFill } from "remotion";
import { mix } from "../motion.ts";
import { COLOURS } from "../theme.ts";

/** Cream field with two soft corner shapes that drift slowly and stop before the call to action. */
export function Background({ frame, u }: { frame: number; u: number }) {
  const drift = frame / 269;
  return (
    <AbsoluteFill style={{ background: COLOURS.cream, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: mix(-200, -150, drift) * u,
          top: mix(-220, -180, drift) * u,
          width: 520 * u,
          height: 520 * u,
          borderRadius: "50%",
          background: COLOURS.herb,
          opacity: 0.12,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: mix(760, 720, drift) * u,
          top: mix(1680, 1640, drift) * u,
          width: 560 * u,
          height: 560 * u,
          borderRadius: "50%",
          background: COLOURS.tomato,
          opacity: 0.12,
        }}
      />
    </AbsoluteFill>
  );
}
