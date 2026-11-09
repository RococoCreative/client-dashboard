// Demo entry: mounts the real App, while demo/vite.config.ts points every service at
// src/test/mocks, so any screen can be checked without a Supabase project.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "../src/App.tsx";
import ErrorBoundary from "../src/components/ErrorBoundary.tsx";
import "./main.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
