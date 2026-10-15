import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";

export type LocalFont = {
  family: string;
  /** URL from useAsset(), e.g. useAsset("brand:inter-bold.woff2"). */
  url: string;
  weight?: string;
  style?: string;
};

/**
 * Load a font from a local asset and hold rendering until it is ready, so no
 * frame is ever drawn with a fallback font. Returns true once loaded.
 */
export function useLocalFont({
  family,
  url,
  weight = "normal",
  style = "normal",
}: LocalFont): boolean {
  const [loaded, setLoaded] = useState(false);
  const [handle] = useState(() => delayRender(`Loading font ${family}`));

  useEffect(() => {
    let cancelled = false;
    const face = new FontFace(family, `url(${JSON.stringify(url)})`, { weight, style });
    face
      .load()
      .then((ready) => {
        if (cancelled) return;
        document.fonts.add(ready);
        setLoaded(true);
        continueRender(handle);
      })
      .catch((error: unknown) => {
        if (!cancelled)
          cancelRender(error instanceof Error ? error : new Error(`Font ${family} failed to load`));
      });
    return () => {
      cancelled = true;
    };
  }, [family, url, weight, style, handle]);

  return loaded;
}
