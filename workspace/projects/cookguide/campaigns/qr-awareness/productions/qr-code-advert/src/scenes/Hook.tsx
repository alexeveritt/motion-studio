import { mix, ramp } from "../motion.ts";
import { COLOURS, FONT } from "../theme.ts";

/**
 * Frames 0–59: the opening question. Fully legible from frame 0 (it is often
 * the thumbnail); only a gentle settle-in moves it.
 */
export function Hook({ frame, u }: { frame: number; u: number }) {
  const settle = ramp(frame, 0, 14);
  const exit = ramp(frame, 50, 66);
  if (exit >= 1) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: 700 * u,
        left: 90 * u,
        right: 90 * u,
        textAlign: "center",
        fontFamily: FONT,
        fontWeight: 800,
        fontSize: 104 * u,
        lineHeight: 1.08,
        letterSpacing: -2 * u,
        color: COLOURS.ink,
        opacity: 1 - exit,
        transform: `translateY(${-mix(0, 60, exit) * u}px) scale(${mix(0.96, 1, settle)})`,
      }}
    >
      Not sure what to cook tonight?
    </div>
  );
}
