import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { MotionStudioError } from "./errors.ts";
import { isInside } from "./repo.ts";

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/;

/**
 * Validate one path segment supplied by code or derived from request data.
 * Segments may not contain separators, traversal, control or bidi characters,
 * or start with a dot.
 */
export function assertSafeSegment(segment: string): void {
  if (
    segment.length === 0 ||
    segment.length > 255 ||
    segment === "." ||
    segment === ".." ||
    segment.startsWith(".") ||
    segment.includes("/") ||
    segment.includes("\\") ||
    CONTROL_CHARACTERS.test(segment)
  ) {
    throw new MotionStudioError("UNSAFE_PATH", "Path segment is not allowed");
  }
}

/**
 * The single place where Motion Studio turns segments into filesystem paths.
 * Every resolved path must stay inside one of the allowed roots, both
 * lexically and after resolving symlinks on the existing part of the path.
 */
export class PathPolicy {
  readonly roots: readonly string[];

  constructor(roots: string[]) {
    if (roots.length === 0) throw new Error("PathPolicy requires at least one root");
    this.roots = roots.map((root) => {
      if (!path.isAbsolute(root)) throw new Error("PathPolicy roots must be absolute");
      return path.resolve(root);
    });
  }

  /**
   * Resolve `segments` beneath `base`. `base` must already be inside an
   * allowed root. Throws UNSAFE_PATH when anything would escape.
   */
  resolve(base: string, ...segments: string[]): string {
    for (const segment of segments) assertSafeSegment(segment);
    const target = path.resolve(base, ...segments);
    this.assertAllowed(target);
    return target;
  }

  /**
   * Resolve a repository-style relative path such as "brand/brand.md" beneath
   * `base`, validating every segment.
   */
  resolveRelative(base: string, relativePath: string): string {
    return this.resolve(base, ...relativePath.split("/"));
  }

  /** Confirm an absolute path is inside an allowed root and does not escape through symlinks. */
  assertAllowed(target: string): void {
    if (!path.isAbsolute(target)) {
      throw new MotionStudioError("UNSAFE_PATH", "Path must be absolute");
    }
    const resolved = path.resolve(target);
    const root = this.roots.find((candidate) => isInside(candidate, resolved));
    if (!root) {
      throw new MotionStudioError("UNSAFE_PATH", "Path is outside the allowed folders");
    }

    // Walk from the root to the target. No existing component below the root
    // may be a symlink, so a link planted inside the workspace cannot redirect
    // a write elsewhere.
    const canonicalRoot = safeRealpath(root) ?? root;
    const relative = path.relative(root, resolved);
    let current = root;
    for (const segment of relative === "" ? [] : relative.split(path.sep)) {
      current = path.join(current, segment);
      let stats;
      try {
        stats = lstatSync(current);
      } catch {
        break; // The remainder does not exist yet; nothing more to follow.
      }
      if (stats.isSymbolicLink()) {
        throw new MotionStudioError(
          "UNSAFE_PATH",
          "Symbolic links are not allowed in the workspace",
        );
      }
    }
    const canonical = safeRealpath(resolved);
    if (canonical && !isInside(canonicalRoot, canonical)) {
      throw new MotionStudioError("UNSAFE_PATH", "Path resolves outside the allowed folders");
    }
  }
}

function safeRealpath(target: string): string | undefined {
  try {
    return realpathSync(target);
  } catch {
    return undefined;
  }
}
