/**
 * Remove absolute filesystem prefixes from error text shown in the UI,
 * keeping the repository-relative part (spec section 13.4).
 */
export function redactPaths(message: string): string {
  return message.replace(
    /(?:file:\/\/|\/@fs)?(?:\/[^\s/:'"()]+)+?\/(?=(?:workspace|fixtures|packages|apps|\.motion-studio|node_modules)\/)/g,
    "",
  );
}
