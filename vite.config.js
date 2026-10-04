import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";
import vue from "@vitejs/plugin-vue";

import { e2eMapFixtures } from "./tests/e2e/fixtures/map/vitePlugin.mjs";

// Serve the committed E2E map fixtures only when the Playwright webServer opts
// in; production and normal dev runs are completely unaffected.
const e2eFixtures = process.env.VITE_E2E_FIXTURES === "1";

export default defineConfig({
  plugins: [vue(), ...(e2eFixtures ? [e2eMapFixtures()] : [])],

  css: {
    preprocessorOptions: {
      scss: {
        quietDeps: true,
        silenceDeprecations: ["import", "legacy-js-api"],
      },
    },
  },

  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },

  server: {
    host: "127.0.0.1",
    port: 5174,
    strictPort: true,
    open: "/index.html",
  },
});
