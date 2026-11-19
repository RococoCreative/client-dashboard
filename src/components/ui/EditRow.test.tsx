// Pins the read-first row: text and a named pencil by default, the form and Done while editing.
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import EditRow from "./EditRow.tsx";

describe("EditRow", () => {
  it("shows the display and a pencil that starts editing", async () => {
    const onEdit = vi.fn();
    render(
      <EditRow display={<span>Optimization rate: 12</span>} editLabel="Edit Optimization rate" editing={false} onEdit={onEdit} onDone={vi.fn()}>
        <input aria-label="Rate" />
      </EditRow>,
    );
    expect(screen.getByText("Optimization rate: 12")).toBeInTheDocument();
    expect(screen.queryByLabelText("Rate")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit Optimization rate" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("shows the form and Done while editing", async () => {
    const onDone = vi.fn();
    render(
      <EditRow display={<span>Optimization rate: 12</span>} editLabel="Edit Optimization rate" editing onEdit={vi.fn()} onDone={onDone}>
        <input aria-label="Rate" />
      </EditRow>,
    );
    expect(screen.getByLabelText("Rate")).toBeInTheDocument();
    expect(screen.queryByText("Optimization rate: 12")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
