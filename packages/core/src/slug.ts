/** Lowercase ASCII letters and digits separated by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 64;

/**
 * Names that are unsafe as directory names on common filesystems, plus "new",
 * which the studio uses for creation routes.
 */
const RESERVED_SLUGS = new Set([
  "new",
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

export function isReservedSlug(value: string): boolean {
  return RESERVED_SLUGS.has(value);
}

export function isValidSlug(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(value) &&
    !isReservedSlug(value)
  );
}

/**
 * Derive a slug from a display name. Returns an empty string when nothing
 * usable remains; callers must treat that as a validation error.
 */
export function slugify(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
  return isReservedSlug(slug) ? `${slug}-item` : slug;
}
