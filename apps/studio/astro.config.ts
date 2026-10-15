import node from "@astrojs/node";
import react from "@astrojs/react";
import {
  findRepoRoot,
  loadSettings,
  resolveWorkspaceRoot,
  WorkspaceService,
  writeRegistry,
} from "@motion-studio/core";
import { defineConfig } from "astro/config";
import { registryIntegration } from "./src/lib/server/registry-integration.ts";

const repoRoot = findRepoRoot(import.meta.dirname);
const settings = await loadSettings(repoRoot);
const workspaceRoot = resolveWorkspaceRoot(
  repoRoot,
  settings,
  process.env.MOTION_STUDIO_WORKSPACE || undefined,
);
// Generate the composition registry for this workspace before Vite starts.
const registry = await writeRegistry(new WorkspaceService({ repoRoot, workspaceRoot, settings }));

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react(), registryIntegration()],
  // Loopback only. The settings schema rejects any other host.
  server: { host: settings.server.host, port: settings.server.port },
  security: { checkOrigin: true },
  devToolbar: { enabled: false },
  vite: {
    resolve: {
      alias: { "virtual:motion-studio/registry": registry.file },
      // Compositions live outside this app; make sure they share one React and Remotion.
      dedupe: ["react", "react-dom", "remotion"],
    },
    // Composition errors are shown in the preview's own overlay without blocking navigation.
    server: { hmr: { overlay: false } },
  },
});
