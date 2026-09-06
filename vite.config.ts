import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// @ts-expect-error The build plugin runs directly in Node.
import ephemeralBuild from "./scripts/ephemeral-build.mjs";

export default defineConfig({
  plugins: [ephemeralBuild(), react()],
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
