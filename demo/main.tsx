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
