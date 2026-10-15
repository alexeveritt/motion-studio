import type { ComponentType } from "react";

/**
 * The contract every production entry (`src/composition.tsx`) fulfils:
 *
 *   export const composition: MotionStudioComposition<Props> = {
 *     id: "<compositionId from production.json>",
 *     Component: MyAdvert,
 *     defaultProps: { ... },
 *   };
 *
 * Width, height, FPS and duration are not part of the contract: they come
 * from production.json so the studio, preview and renderer agree.
 */
export type MotionStudioComposition<
  Props extends Record<string, unknown> = Record<string, unknown>,
> = {
  id: string;
  Component: ComponentType<Props>;
  defaultProps: Props;
};

/** One entry in the generated registry. Loading is lazy so one broken production cannot break the rest. */
export type RegistryEntry = {
  productionId: string;
  /** Repository-relative path of the entry file, for messages. */
  entry: string;
  load: () => Promise<unknown>;
};

export type Registry = Readonly<Record<string, RegistryEntry>>;

/**
 * Check a loaded entry module and return its composition. Throws an Error
 * whose message tells the author exactly what to fix.
 */
export function validateComposition(
  module: unknown,
  expectedId: string,
  entry: string,
): MotionStudioComposition {
  const composition = (module as { composition?: unknown } | null)?.composition as
    Partial<MotionStudioComposition> | undefined;
  if (!composition || typeof composition !== "object") {
    throw new Error(`${entry} must export \`const composition: MotionStudioComposition\`.`);
  }
  if (composition.id !== expectedId) {
    throw new Error(
      `${entry} exports composition.id "${String(composition.id)}", but production.json expects "${expectedId}".`,
    );
  }
  if (typeof composition.Component !== "function" && typeof composition.Component !== "object") {
    throw new Error(`${entry}: composition.Component must be a React component.`);
  }
  if (
    !composition.defaultProps ||
    typeof composition.defaultProps !== "object" ||
    Array.isArray(composition.defaultProps)
  ) {
    throw new Error(
      `${entry}: composition.defaultProps must be an object (use {} when there are none).`,
    );
  }
  return composition as MotionStudioComposition;
}

/**
 * Input props are the composition's defaults overlaid with the production's
 * `props.json`. Preview and render both call this, so they always agree.
 */
export function resolveInputProps(
  composition: MotionStudioComposition,
  productionProps: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...composition.defaultProps, ...productionProps };
}
