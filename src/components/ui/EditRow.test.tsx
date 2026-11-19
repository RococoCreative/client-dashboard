// Pins the read-first row: text and a named pencil by default, the form and Done while editing.
import { useState, type ReactNode } from "react";
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

  // A row that owns its open state the way every list does, so the focus hand-off is seen end to end.
  function Harness({ onDone = vi.fn(), footer }: { onDone?: () => void; footer?: ReactNode }) {
    const [editing, setEditing] = useState(false);
    return (
      <EditRow
        display={<span>Optimization rate: 12</span>}
        editLabel="Edit Optimization rate"
        editing={editing}
        onEdit={() => setEditing(true)}
        onDone={() => {
          onDone();
          setEditing(false);
        }}
        footer={footer}
      >
        <input aria-label="Name" />
        <input aria-label="Rate" />
      </EditRow>
    );
  }

  it("moves focus to the first field on open and back to the pencil on Done", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Optimization rate" }));
    expect(screen.getByLabelText("Name")).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: "Edit Optimization rate" })).toHaveFocus();
  });

  it("closes on Escape, saving the field first, and returns focus to the pencil", async () => {
    const onDone = vi.fn();
    const onBlur = vi.fn();
    render(<Harness onDone={onDone} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Optimization rate" }));
    screen.getByLabelText("Name").addEventListener("blur", onBlur);
    await userEvent.keyboard("{Escape}");
    expect(onBlur).toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit Optimization rate" })).toHaveFocus();
  });

  it("does not move focus when it mounts already open", () => {
    render(
      <EditRow display={<span>x</span>} editLabel="Edit x" editing onEdit={vi.fn()} onDone={vi.fn()}>
        <input aria-label="Rate" />
      </EditRow>,
    );
    expect(screen.getByLabelText("Rate")).not.toHaveFocus();
  });

  it("puts a worded footer action beside Done, only while open", async () => {
    const onRemove = vi.fn();
    render(<Harness footer={<button type="button" onClick={onRemove}>Remove</button>} />);
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Edit Optimization rate" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("keeps row actions on the row in both states and renders as a list item when asked", async () => {
    render(
      <ul>
        <EditRow as="li" display={<span>Step</span>} editLabel="Edit Step" editing={false} onEdit={vi.fn()} onDone={vi.fn()} actions={<button type="button">Move up</button>} leading={<input type="checkbox" aria-label="Done step" />}>
          <input aria-label="Rename" />
        </EditRow>
      </ul>,
    );
    expect(screen.getByRole("listitem")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move up" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Done step" })).toBeInTheDocument();
  });
});
