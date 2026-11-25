// Demo mode: `npm run demo` runs the real app against the in-memory sample data in
// src/test/mocks (the same modules the page tests render against), so every screen can be
// walked with no Supabase project. Persona and company come from the URL:
//   /?persona=admin|employee|owner|manager|rococo&company=klasik|kingdom|rba   and   /?signedout=1
// Two switches change the sample data, and both can be on together:
//   &load=dense       a heavier RBA roster (src/test/denseLoad.ts)
//   &gsr=on_demand    RBA on GSRs on demand, with GSRs dated back from today (src/test/onDemandDemo.ts)
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
        find: /^(.*)\/services\/(supabase|auth|profiles|companies|invitations|gsr|gsrOnDemand|sops|sopCategories|sopSignoffs|resources|storage|financials|marketing|employees|deliverables|jobRoles|connections|audit|projects|wins|tasks|sync|externalLinks|focusTopics|scorecards|divisions|directory|projectAssignments|reviewProjectNotes|capabilities|milestoneTemplates|connectorRequests|rococoAdmins)\.ts$/,
        replacement: `${REPO}/src/test/mocks/$2.ts`,
      },
    ],
  },
  server: { port: 4173, strictPort: true, fs: { allow: [REPO] } },
});
