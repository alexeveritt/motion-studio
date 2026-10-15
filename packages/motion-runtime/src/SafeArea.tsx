import type { CSSProperties, ReactNode } from "react";
import { AbsoluteFill } from "remotion";

export type Insets = { top: number; right: number; bottom: number; left: number };

/** Social-video safe area as fractions of the frame: keeps text clear of platform UI. */
export const PORTRAIT_SAFE_AREA: Insets = { top: 0.1, right: 0.06, bottom: 0.18, left: 0.06 };

/**
 * Lays children out inside the safe area. Pass `showGuide` to outline it
 * (useful while developing; turn it off before approval).
 */
export function SafeArea({
  insets = PORTRAIT_SAFE_AREA,
  showGuide = false,
  style,
  children,
}: {
  insets?: Insets;
  showGuide?: boolean;
  style?: CSSProperties;
  children?: ReactNode;
}) {
  return (
    <AbsoluteFill
      style={{
        top: `${insets.top * 100}%`,
        right: `${insets.right * 100}%`,
        bottom: `${insets.bottom * 100}%`,
        left: `${insets.left * 100}%`,
        width: "auto",
        height: "auto",
        outline: showGuide ? "4px dashed rgba(255, 0, 128, 0.8)" : undefined,
        ...style,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}
