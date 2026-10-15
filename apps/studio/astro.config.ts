import node from "@astrojs/node";
import react from "@astrojs/react";
import { findRepoRoot, loadSettings } from "@motion-studio/core";
import { defineConfig } from "astro/config";

const settings = await loadSettings(findRepoRoot(import.meta.dirname));

export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [react()],
  // Loopback only. The settings schema rejects any other host.
  server: { host: settings.server.host, port: settings.server.port },
  security: { checkOrigin: true },
  devToolbar: { enabled: false },
});
