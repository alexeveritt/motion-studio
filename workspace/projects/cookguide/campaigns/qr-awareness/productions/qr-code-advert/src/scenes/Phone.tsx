import { useAsset } from "@motion-studio/motion-runtime";
import { Img } from "remotion";
import { mix, ramp } from "../motion.ts";
import { COLOURS, FONT } from "../theme.ts";

/** Step cards inside the screen artwork, as fractions of its 1140-unit height. */
const STEP_TOPS = [584, 736, 888].map((y) => y / 1140);
const STEP_HEIGHT = 132 / 1140;

/**
 * Frames 60–269: the app screen rises in with the benefit line, a highlight
 * walks through the recipe steps, then the phone shrinks away as the action
 * card takes over.
 */
export function Phone({ frame, u }: { frame: number; u: number }) {
  const enter = ramp(frame, 60, 92);
  const leave = ramp(frame, 186, 232);
  if (enter <= 0 || leave >= 1) return null;

  const screenWidth = 470 * u;
  const screenHeight = screenWidth * (1140 / 540);
  const bezel = 18 * u;
  const step = frame < 118 ? 0 : frame < 150 ? 1 : 2;
  const stepMove = step === 0 ? 0 : step === 1 ? ramp(frame, 118, 130) : 1 + ramp(frame, 150, 162);
  const highlightTop = mix(STEP_TOPS[0]!, STEP_TOPS[2]!, stepMove / 2);
  const benefit = ramp(frame, 74, 96) * (1 - ramp(frame, 180, 196));

  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 330 * u,
          left: 80 * u,
          right: 80 * u,
          textAlign: "center",
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: 66 * u,
          lineHeight: 1.12,
          letterSpacing: -1 * u,
          color: COLOURS.ink,
          opacity: benefit,
          transform: `translateY(${mix(24, 0, benefit) * u}px)`,
        }}
      >
        Step-by-step guidance <span style={{ color: COLOURS.herb }}>for every recipe</span>
      </div>
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 520 * u,
          width: screenWidth + bezel * 2,
          height: screenHeight + bezel * 2,
          marginLeft: -(screenWidth / 2 + bezel),
          boxSizing: "border-box",
          borderRadius: 64 * u,
          background: COLOURS.ink,
          padding: bezel,
          boxShadow: `0 ${30 * u}px ${80 * u}px rgba(29, 27, 22, 0.25)`,
          opacity: 1 - leave,
          transform: `translateY(${mix(1100, 0, enter) * u}px) scale(${mix(1, 0.55, leave)})`,
          transformOrigin: "50% 40%",
        }}
      >
        <div
          style={{
            position: "relative",
            width: screenWidth,
            height: screenHeight,
            borderRadius: 46 * u,
            overflow: "hidden",
          }}
        >
          <Img
            src={useAsset("production:placeholder-phone-recipe.svg")}
            alt=""
            style={{ width: "100%", height: "100%" }}
          />
          <div
            style={{
              position: "absolute",
              left: (32 / 540) * screenWidth - 6 * u,
              width: (476 / 540) * screenWidth + 12 * u,
              top: highlightTop * screenHeight - 6 * u,
              height: STEP_HEIGHT * screenHeight + 12 * u,
              borderRadius: 26 * u,
              border: `${6 * u}px solid ${COLOURS.tomato}`,
              opacity: ramp(frame, 96, 108),
            }}
          />
        </div>
      </div>
    </>
  );
}
