// Smoke coverage for the app gate on the unconfigured-Supabase path (how tests and fresh
// clones run): the app must render a setup notice, never crash or demand login.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App.tsx";

describe("App without Supabase env vars", () => {
  it("renders the setup notice instead of crashing or gating", () => {
    render(<App />);
    expect(screen.getByText(/Supabase is not configured yet/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/work email/i)).not.toBeInTheDocument();
  });
});
