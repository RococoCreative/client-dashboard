// Demo mode: `npm run demo` runs the real app against the in-memory sample data in
// src/test/mocks (the same modules the page tests render against), so every screen can be
// walked with no Supabase project. Persona and company come from the URL:
//   /?persona=admin|employee|rococo&company=klasik|kingdom|rba   and   /?signedout=1
// Nothing is written anywhere; a reload resets the data.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "..");

export default defineConfig({
  root: import.meta.dirname,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^(.*)\/services\/(supabase|auth|profiles|companies|invitations|gsr|sops|resources|storage|financials|marketing|employees)\.ts$/,
        replacement: `${REPO}/src/test/mocks/$2.ts`,
      },
    ],
  },
  server: { port: 4173, strictPort: true, fs: { allow: [REPO] } },
});
