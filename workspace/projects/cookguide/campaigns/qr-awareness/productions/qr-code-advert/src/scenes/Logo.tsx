import { useAsset } from "@motion-studio/motion-runtime";
import { Img } from "remotion";
import { COLOURS, FONT, SAFE } from "../theme.ts";

/** CookGuide lockup at the top of the safe area, visible from the first frame and never moving. */
export function Logo({ u }: { u: number }) {
  return (
    <div
      style={{
        position: "absolute",
        top: (SAFE.top + 8) * u,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 20 * u,
      }}
    >
      <Img
        src={useAsset("brand:placeholder-logo-mark.svg")}
        alt=""
        style={{ width: 88 * u, height: 88 * u }}
      />
      <span
        style={{
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 64 * u,
          color: COLOURS.ink,
          letterSpacing: -1 * u,
        }}
      >
        CookGuide
      </span>
    </div>
  );
}
