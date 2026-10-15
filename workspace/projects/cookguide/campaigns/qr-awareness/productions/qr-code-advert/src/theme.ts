/** CookGuide palette and type from brand/brand.md. */
export const COLOURS = {
  cream: "#FFF6E9",
  herb: "#2E7D4F",
  tomato: "#E4572E",
  ink: "#1D1B16",
  white: "#FFFFFF",
  black: "#000000",
} as const;

export const FONT = "Inter";

/**
 * Scene boundaries from the brief (inclusive frame ranges at 30 fps).
 * Every animation finishes before CTA_START so the QR code is static from
 * frame 270 to the last frame.
 */
export const SCENES = {
  hook: [0, 59],
  value: [60, 179],
  transition: [180, 269],
  cta: [270, 359],
} as const;

export const LAST_ANIMATED_FRAME = SCENES.transition[1];

/** Layout is designed on a 1080 × 1920 canvas; `u` scales it to the actual width. */
export const DESIGN_WIDTH = 1080;

/** Portrait safe area in design pixels (top 10 %, bottom 18 %, sides 6 %). */
export const SAFE = { top: 192, bottom: 1574, left: 65, right: 1015 } as const;
