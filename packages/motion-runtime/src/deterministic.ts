import { random } from "remotion";

/**
 * Seeded helpers. Compositions must never use Math.random, Date.now or the
 * network; everything is derived from the frame, props and a fixed seed.
 */
export { random };

/** Deterministic number in [min, max) for a given seed. */
export function seededRange(seed: string | number, min: number, max: number): number {
  return min + random(seed) * (max - min);
}

/** Deterministic integer in [min, max] for a given seed. */
export function seededInt(seed: string | number, min: number, max: number): number {
  return Math.floor(seededRange(seed, min, max + 1));
}
