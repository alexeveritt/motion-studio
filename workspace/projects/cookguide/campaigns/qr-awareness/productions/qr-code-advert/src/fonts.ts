import { useAsset, useLocalFont } from "@motion-studio/motion-runtime";
import { FONT } from "./theme.ts";

/** Load Inter 400, 600 and 800 from the brand assets; rendering waits until all three are ready. */
export function useInter(): boolean {
  const regular = useLocalFont({
    family: FONT,
    url: useAsset("brand:inter-latin-400-normal.woff2"),
    weight: "400",
  });
  const semibold = useLocalFont({
    family: FONT,
    url: useAsset("brand:inter-latin-600-normal.woff2"),
    weight: "600",
  });
  const extrabold = useLocalFont({
    family: FONT,
    url: useAsset("brand:inter-latin-800-normal.woff2"),
    weight: "800",
  });
  return regular && semibold && extrabold;
}
