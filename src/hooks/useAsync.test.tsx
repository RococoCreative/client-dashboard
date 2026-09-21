// useAsync decides what stays on screen when a load fails, and that decision is not the same
// for a reload as for a deps change. Both are pinned here because both are invisible in a page
// test: the mocked data layer never rejects.
import { act, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useAsync } from "./useAsync.ts";

function Probe({ year, load }: { year: number; load: (year: number) => Promise<string> }) {
  const state = useAsync(() => load(year), [year]);
  return (
    <div>
      <p data-testid="data">{state.data ?? "none"}</p>
      <p data-testid="error">{state.error || "none"}</p>
      <button type="button" onClick={state.reload}>
        reload
      </button>
    </div>
  );
}

describe("useAsync", () => {
  it("keeps what is on screen when a reload of the same query fails", async () => {
    const load = vi
      .fn<(year: number) => Promise<string>>()
      .mockResolvedValueOnce("2026 goals")
      .mockRejectedValueOnce(new Error("Network down."));
    const view = render(<Probe year={2026} load={load} />);
    await waitFor(() => expect(view.getByTestId("data").textContent).toBe("2026 goals"));

    await act(async () => {
      view.getByRole("button", { name: "reload" }).click();
    });
    // A flaky signal must not blank a page somebody is reading, and the rows still answer the
    // question the page is asking.
    // lib/errors.ts rewrites the raw error into a friendly line, so assert only that one showed.
    await waitFor(() => expect(view.getByTestId("error").textContent).not.toBe("none"));
    expect(view.getByTestId("data").textContent).toBe("2026 goals");
  });

  it("drops what is on screen when a failed load was for a different query", async () => {
    const load = vi
      .fn<(year: number) => Promise<string>>()
      .mockResolvedValueOnce("2026 goals")
      .mockRejectedValueOnce(new Error("Network down."));
    const view = render(<Probe year={2026} load={load} />);
    await waitFor(() => expect(view.getByTestId("data").textContent).toBe("2026 goals"));

    view.rerender(<Probe year={2025} load={load} />);
    // The page around the rows already says 2025. Leaving 2026's rows there, with their edit
    // and delete actions live, would have the screen assert something untrue about the year.
    // lib/errors.ts rewrites the raw error into a friendly line, so assert only that one showed.
    await waitFor(() => expect(view.getByTestId("error").textContent).not.toBe("none"));
    expect(view.getByTestId("data").textContent).toBe("none");
  });
});
