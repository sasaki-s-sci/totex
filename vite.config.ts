import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
// @ts-expect-error The build plugin runs directly in Node.
import ephemeralBuild from "./scripts/ephemeral-build.mjs";

export default defineConfig({
  // Keep SDK modules available to the transform in development as well.
  optimizeDeps: { exclude: ["@tauri-apps/api"] },
  build: { rollupOptions: { input: { shell: "index.html", front: "front.html" } } },
  plugins: [
    {
      name: "shell-native-slots",
      enforce: "pre",
      transform(code, id) {
        if (!/\/@tauri-apps\/api\/[^?]+\.js(?:\?|$)/.test(id.replaceAll("\\", "/"))) return;
        return {
          code: code
            .replaceAll(
              "window.__TAURI_INTERNALS__.",
              "(window.__TOTEX_NATIVE__ ?? window.__TAURI_INTERNALS__).",
            )
            .replaceAll(
              "window.__TAURI_EVENT_PLUGIN_INTERNALS__.",
              "(window.__TOTEX_EVENTS__ ?? window.__TAURI_EVENT_PLUGIN_INTERNALS__).",
            ),
          map: null,
        };
      },
    },
    ephemeralBuild(),
    react(),
    viteStaticCopy({
      targets: ["cmaps", "standard_fonts", "wasm"].map((folder) => ({
        src: `node_modules/pdfjs-dist/${folder}`,
        dest: "pdf-assets",
      })),
    }),
  ],
  // Tauri drives this dev server, so keep its output visible.
  clearScreen: false,
  server: {
    // Only where `pnpm dev` lands on its own. `task dev` reserves a free port
    // and passes it on the command line, to both this and the window — a fixed
    // port is a port a dev server from an earlier run can still be holding.
    port: 1420,
    // Whichever port was settled on is the one the window will be pointed at,
    // so sliding quietly to the next free one would leave it loading nothing.
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
