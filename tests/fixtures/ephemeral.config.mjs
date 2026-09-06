import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import ephemeralBuild from "../../scripts/ephemeral-build.mjs";
export default defineConfig({
  plugins: [ephemeralBuild(), react()],
  build: {
    outDir: "/tmp/totex-ephemeral-browser",
    emptyOutDir: true,
    rollupOptions: { input: "tests/fixtures/ephemeral.html" },
  },
});
