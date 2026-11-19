// Pins the save contract every inline field relies on: a declined draft goes back, a failed
// async save stays visible and retries on the next blur, and a landed save says so.
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import BlurInput from "./BlurInput.tsx";

function Harness({ onSave }: { onSave: (next: string, set: (v: string) => void) => ReturnType<Parameters<typeof BlurInput>[0]["onSave"]> }) {
  const [value, setValue] = useState("Old");
  return <BlurInput ariaLabel="Name" value={value} onSave={(next) => onSave(next, setValue)} />;
}

function type(text: string) {
  const box = screen.getByLabelText("Name");
  fireEvent.change(box, { target: { value: text } });
  fireEvent.blur(box);
  return box;
}

describe("BlurInput", () => {
  it("puts the stored value back when the caller declines", () => {
    render(<Harness onSave={() => false} />);
    const box = type("New");
    expect(box).toHaveValue("Old");
  });

  it("marks a landed save as saved", async () => {
    render(<Harness onSave={async (next, set) => { set(next); return true; }} />);
    const box = type("New");
    await act(async () => {});
    expect(box).toHaveValue("New");
    expect(box).toHaveAttribute("data-save-state", "saved");
    expect(screen.getByText("Saved")).toBeInTheDocument();
  });

  it("keeps the typed text and says Not saved when the save fails, then retries on blur", async () => {
    const save = vi.fn<(next: string, set: (v: string) => void) => Promise<boolean>>().mockResolvedValueOnce(false).mockImplementationOnce(async (next, set) => { set(next); return true; });
    render(<Harness onSave={save} />);
    const box = type("New");
    await act(async () => {});
    expect(box).toHaveValue("New");
    expect(box).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/Not saved/)).toBeInTheDocument();
    fireEvent.blur(box);
    await act(async () => {});
    expect(save).toHaveBeenCalledTimes(2);
    expect(box).toHaveAttribute("data-save-state", "saved");
  });

  it("treats a rejected save as not saved", async () => {
    render(<Harness onSave={() => Promise.reject(new Error("offline"))} />);
    const box = type("New");
    await act(async () => {});
    expect(box).toHaveAttribute("data-save-state", "failed");
  });

  it("shows Not saved as visible text tied to the field, and clears it after a later success", async () => {
    const save = vi.fn<(next: string, set: (v: string) => void) => Promise<boolean>>().mockResolvedValueOnce(false).mockImplementationOnce(async (next, set) => { set(next); return true; });
    render(<Harness onSave={save} />);
    const box = type("New");
    await act(async () => {});
    const note = screen.getByText("Not saved");
    expect(note).toBeVisible();
    expect(note).not.toHaveClass("sr-only");
    expect(box).toHaveAttribute("aria-describedby", note.id);
    expect(box).toHaveAccessibleDescription("Not saved");
    fireEvent.blur(box);
    await act(async () => {});
    expect(screen.queryByText("Not saved")).not.toBeInTheDocument();
    expect(box).not.toHaveAttribute("aria-describedby");
  });

  it("drops Not saved when the stored value is typed back in", async () => {
    render(<Harness onSave={() => Promise.resolve(false)} />);
    const box = type("New");
    await act(async () => {});
    expect(screen.getByText("Not saved")).toBeVisible();
    fireEvent.change(box, { target: { value: "Old" } });
    expect(screen.queryByText("Not saved")).not.toBeInTheDocument();
    expect(box).not.toHaveAttribute("aria-invalid");
  });

  it("keeps the field's sizing classes on a wrapper so a flex row does not change", async () => {
    render(<BlurInput ariaLabel="Name" value="Old" onSave={() => Promise.resolve(false)} className="mt-0 min-w-0 flex-1 sm:w-48" />);
    const box = screen.getByLabelText("Name");
    expect(box.parentElement).toHaveClass("min-w-0", "flex-1", "sm:w-48");
    expect(box.parentElement).not.toHaveClass("mt-0");
  });

  it("does not call onSave when nothing changed", () => {
    const save = vi.fn();
    render(<Harness onSave={save} />);
    fireEvent.blur(screen.getByLabelText("Name"));
    expect(save).not.toHaveBeenCalled();
  });
});
