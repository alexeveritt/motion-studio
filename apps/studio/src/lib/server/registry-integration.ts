import type { AstroIntegration } from "astro";

type Invalidate = (file: string) => void;

const KEY = Symbol.for("motion-studio.invalidate-registry");

/**
 * Captures the Vite dev server so the studio can invalidate the generated
 * registry module the moment it rewrites it. Without this, a page loaded
 * right after a new entry file appears can receive the stale module before
 * the file watcher catches up.
 */
export function registryIntegration(): AstroIntegration {
  return {
    name: "motion-studio-registry",
    hooks: {
      "astro:server:setup": ({ server }) => {
        const invalidate: Invalidate = (file) => {
          for (const environment of Object.values(server.environments)) {
            const graph = environment.moduleGraph;
            for (const module of graph.getModulesByFile(file) ?? []) graph.invalidateModule(module);
          }
        };
        (globalThis as Record<symbol, unknown>)[KEY] = invalidate;
      },
    },
  };
}

export function invalidateRegistryModule(file: string): void {
  const invalidate = (globalThis as Record<symbol, unknown>)[KEY] as Invalidate | undefined;
  invalidate?.(file);
}
