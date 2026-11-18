// Pins the slider's save contract: a completion the database did not take never stays on the
// thumb. A failed save (rejected, or resolved false) puts the stored value back and says so; a
// landed one keeps the new value; a caller that returns nothing keeps the old behaviour.
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import ProgressSlider, { type CommitResult } from "./ProgressSlider.tsx";

function Harness({ onCommit }: { onCommit: (next: number, set: (v: number) => void) => CommitResult }) {
  const [value, setValue] = useState(40);
  return <ProgressSlider label="Completion" value={value} onCommit={(next) => onCommit(next, setValue)} />;
}

function drag(to: number) {
  const slider = screen.getByLabelText("Completion");
  fireEvent.change(slider, { target: { value: String(to) } });
  fireEvent.pointerUp(slider);
  return slider;
}

describe("ProgressSlider", () => {
  it("keeps a completion that saved", async () => {
    render(<Harness onCommit={async (next, set) => { set(next); return true; }} />);
    const slider = drag(70);
    await act(async () => {});
    expect(slider).toHaveValue("70");
    expect(slider).not.toHaveAttribute("aria-invalid");
  });

  it("rolls back to the stored value when the save resolves false", async () => {
    render(<Harness onCommit={async () => false} />);
    const slider = drag(70);
    expect(slider).toHaveValue("70");
    await act(async () => {});
    expect(slider).toHaveValue("40");
    expect(slider).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Not saved. The completion went back to what is stored.")).toBeInTheDocument();
  });

  it("rolls back when the save rejects", async () => {
    render(<Harness onCommit={() => Promise.reject(new Error("Failed to fetch"))} />);
    const slider = drag(90);
    await act(async () => {});
    expect(slider).toHaveValue("40");
  });

  it("lets the same value be tried again after a rollback", async () => {
    const commit = vi.fn<(next: number, set: (v: number) => void) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(async (next, set) => { set(next); return true; });
    render(<Harness onCommit={commit} />);
    drag(70);
    await act(async () => {});
    const slider = drag(70);
    await act(async () => {});
    expect(commit).toHaveBeenCalledTimes(2);
    expect(slider).toHaveValue("70");
    expect(slider).not.toHaveAttribute("aria-invalid");
  });

  it("never pulls the thumb back for an older failure once a newer save is out", async () => {
    let failFirst: (ok: boolean) => void = () => undefined;
    const commit = vi.fn<(next: number, set: (v: number) => void) => Promise<boolean>>()
      .mockImplementationOnce(() => new Promise<boolean>((resolve) => { failFirst = resolve; }))
      .mockImplementationOnce(() => new Promise<boolean>(() => undefined));
    render(<Harness onCommit={commit} />);
    drag(60);
    const slider = drag(80);
    await act(async () => failFirst(false));
    expect(slider).toHaveValue("80");
  });

  it("waits for the value prop when the caller returns nothing", async () => {
    render(<Harness onCommit={() => undefined} />);
    const slider = drag(70);
    await act(async () => {});
    expect(slider).toHaveValue("70");
    expect(slider).not.toHaveAttribute("aria-invalid");
  });
});
