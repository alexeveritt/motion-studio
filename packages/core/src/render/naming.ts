/**
 * Output naming from spec section 11.3:
 *   YYYYMMDD-HHmmss_<production-slug>_<profile-id>_<fingerprint-8>.mp4
 *   ...-poster.png
 *   ....render.json
 */
export const RENDER_ID_PATTERN = /^\d{8}-\d{6}_[a-z0-9-]+_[a-z0-9-]+_[0-9a-f]{8}(?:-\d{1,3})?$/;

export function renderBaseName(
  requestedAt: Date,
  productionSlug: string,
  profileId: string,
  fingerprint: string,
): string {
  const iso = requestedAt.toISOString();
  const stamp = `${iso.slice(0, 10).replaceAll("-", "")}-${iso.slice(11, 19).replaceAll(":", "")}`;
  return `${stamp}_${productionSlug}_${profileId}_${fingerprint.slice(0, 8)}`;
}

export const outputNames = (base: string) => ({
  video: `${base}.mp4`,
  poster: `${base}-poster.png`,
  manifest: `${base}.render.json`,
});

/** Standalone poster renders, which have no video. */
export const posterOnlyNames = (base: string, frame: number) => ({
  poster: `${base}-poster-f${frame}.png`,
  manifest: `${base}-poster-f${frame}.poster.json`,
});

export function isRenderId(value: string): boolean {
  return RENDER_ID_PATTERN.test(value);
}
