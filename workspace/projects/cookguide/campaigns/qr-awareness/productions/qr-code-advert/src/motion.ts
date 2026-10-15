import { Easing, interpolate } from "remotion";

const ease = Easing.inOut(Easing.cubic);

/** 0 → 1 between two frames with gentle easing, clamped outside. */
export function ramp(frame: number, from: number, to: number): number {
  return interpolate(frame, [from, to], [0, 1], {
    easing: ease,
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

/** Linear blend between two values by `t` (0 to 1). */
export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
