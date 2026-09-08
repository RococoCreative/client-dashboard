/// <reference types="vitest/config" />
// Build, dev-server, and test configuration in one place (house pattern from the notation
// app: no separate vitest config). The suite is hermetic by definition: it must behave the
// same on a laptop with a filled-in .env and in CI with nothing, so the runtime config is
// blanked for tests and the unconfigured-Supabase path is what App.test exercises.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        // Dependencies change on a bump, app code on every deploy. Kept apart, a deploy
        // invalidates the small app chunk while the browser keeps the vendor chunks cached.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/ },
            { name: "vendor", test: /node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    testTimeout: 20000,
    env: {
      VITE_SUPABASE_URL: "",
      VITE_SUPABASE_ANON_KEY: "",
    },
  },
});
