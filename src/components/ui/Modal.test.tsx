// The dialog primitives every page leans on. Modal sits over a scrim, so the keyboard has to stay
// inside it: when Tab could walk out, a Delete button under the scrim could open a second dialog
// over a delete that was still running, and its failure then showed up in the wrong place. These
// pin the trap, where focus goes on open and close, and ConfirmDialog holding still while its
// action runs.
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import ConfirmDialog from "./ConfirmDialog.tsx";
import Modal from "./Modal.tsx";

// A page with controls before and after the dialog, the way a real page has them under the scrim.
function Page({ autoFocus = false, inner = false }: { autoFocus?: boolean; inner?: boolean }) {
  const [open, setOpen] = useState(false);
  const [innerOpen, setInnerOpen] = useState(false);
  return (
    <>
      <button type="button">Before</button>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      {open ? (
        <Modal onClose={() => setOpen(false)} labelledBy="outer-title">
          <h2 id="outer-title">Outer</h2>
          <input type="text" aria-label="Name" autoFocus={autoFocus} />
          <button type="button" disabled>Unavailable</button>
          {inner ? (
            <button type="button" onClick={() => setInnerOpen(true)}>Open inner</button>
          ) : null}
          <button type="button" onClick={() => setOpen(false)}>Close</button>
          {innerOpen ? (
            <Modal onClose={() => setInnerOpen(false)} labelledBy="inner-title">
              <h2 id="inner-title">Inner</h2>
              <button type="button">Inner one</button>
              <button type="button" onClick={() => setInnerOpen(false)}>Inner close</button>
            </Modal>
          ) : null}
        </Modal>
      ) : null}
      <button type="button">After</button>
    </>
  );
}

const focused = () => document.activeElement as HTMLElement;

describe("Modal", () => {
  it("moves focus into the panel when it opens", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog")).toContainElement(focused());
  });

  it("keeps Tab and Shift+Tab cycling inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Open" }));

    await user.tab();
    expect(focused()).toBe(screen.getByRole("textbox", { name: "Name" }));
    await user.tab();
    expect(focused()).toBe(screen.getByRole("button", { name: "Close" }));
    // Off the end it goes back to the top, never on to the page underneath.
    await user.tab();
    expect(focused()).toBe(screen.getByRole("textbox", { name: "Name" }));
    await user.tab({ shift: true });
    expect(focused()).toBe(screen.getByRole("button", { name: "Close" }));
    await user.tab({ shift: true });
    expect(focused()).toBe(screen.getByRole("textbox", { name: "Name" }));
  });

  it("brings focus back inside when it has left the dialog", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Open" }));

    // A focused control that goes away (a button disabled while it works) drops focus to the page.
    focused().blur();
    await user.tab();
    expect(focused()).toBe(screen.getByRole("textbox", { name: "Name" }));

    screen.getByRole("button", { name: "After" }).focus();
    await user.tab({ shift: true });
    expect(focused()).toBe(screen.getByRole("button", { name: "Close" }));
  });

  it("leaves Tab to the browser while focus is inside, so a date field can step through its parts", async () => {
    const user = userEvent.setup();
    render(
      <Modal onClose={() => undefined} labelledBy="t">
        <h2 id="t">Campaign</h2>
        <input type="text" aria-label="Name" />
        <input type="date" aria-label="Starts" />
        <button type="button">Save</button>
      </Modal>,
    );
    const starts = screen.getByLabelText("Starts");
    // fireEvent returns false when a listener called preventDefault. The trap must not take the
    // key here: Chrome moves from month to day to year inside the field on Tab.
    expect(fireEvent.keyDown(starts, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(starts, { key: "Tab", shiftKey: true })).toBe(true);
    // The edges are left alone as well; the guards either side of the panel do the wrapping.
    expect(fireEvent.keyDown(screen.getByRole("button", { name: "Save" }), { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Tab", shiftKey: true })).toBe(true);
    // Off the last control, the browser lands on the far guard, which sends focus round to the top.
    screen.getByRole("button", { name: "Save" }).focus();
    await user.tab();
    expect(focused()).toBe(screen.getByRole("textbox", { name: "Name" }));
    await user.tab({ shift: true });
    expect(focused()).toBe(screen.getByRole("button", { name: "Save" }));
  });

  it("takes Tab only when focus is outside the dialog", () => {
    render(<Page />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    screen.getByRole("button", { name: "After" }).focus();
    expect(fireEvent.keyDown(focused(), { key: "Tab" })).toBe(false);
    expect(focused()).toBe(screen.getByRole("textbox", { name: "Name" }));
  });

  it("returns focus to the opener on close", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(focused()).toBe(opener);
  });

  it("leaves an autofocused field focused, and still returns focus to the opener", async () => {
    const user = userEvent.setup();
    render(<Page autoFocus />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    expect(focused()).toBe(screen.getByRole("textbox", { name: "Name" }));
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(focused()).toBe(opener);
  });

  it("does the same under Strict Mode, where React runs the effect twice in development", async () => {
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Page autoFocus />
      </StrictMode>,
    );
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    expect(focused()).toBe(screen.getByRole("textbox", { name: "Name" }));
    await user.keyboard("{Escape}");
    expect(focused()).toBe(opener);
  });

  it("traps Tab in the top dialog when two are stacked, and Escape closes only that one", async () => {
    const user = userEvent.setup();
    render(<Page inner />);
    await user.click(screen.getByRole("button", { name: "Open" }));
    const openInner = screen.getByRole("button", { name: "Open inner" });
    await user.click(openInner);

    await user.tab();
    expect(focused()).toBe(screen.getByRole("button", { name: "Inner one" }));
    await user.tab();
    expect(focused()).toBe(screen.getByRole("button", { name: "Inner close" }));
    await user.tab();
    expect(focused()).toBe(screen.getByRole("button", { name: "Inner one" }));

    await user.keyboard("{Escape}");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(focused()).toBe(openInner);
  });

  it("stops once on a radio group, at the checked radio, as the browser does", async () => {
    const user = userEvent.setup();
    render(
      <Modal onClose={() => undefined} labelledBy="t">
        <h2 id="t">Cadence</h2>
        <input type="radio" name="cadence" aria-label="Monthly" />
        <input type="radio" name="cadence" aria-label="Quarterly" defaultChecked />
        <input type="radio" name="cadence" aria-label="Yearly" />
        <button type="button">Save</button>
      </Modal>,
    );
    await user.tab();
    expect(focused()).toBe(screen.getByRole("radio", { name: "Quarterly" }));
    await user.tab();
    expect(focused()).toBe(screen.getByRole("button", { name: "Save" }));
    await user.tab();
    expect(focused()).toBe(screen.getByRole("radio", { name: "Quarterly" }));
    await user.tab({ shift: true });
    expect(focused()).toBe(screen.getByRole("button", { name: "Save" }));
  });

  it("closes on a press on the backdrop, not on one inside the panel", () => {
    const onClose = vi.fn();
    render(
      <Modal onClose={onClose} labelledBy="t">
        <h2 id="t">Title</h2>
      </Modal>,
    );
    fireEvent.mouseDown(screen.getByRole("heading", { name: "Title" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ConfirmDialog", () => {
  function renderConfirm(busy: boolean) {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmDialog title="Delete it?" body="It goes." confirmLabel="Delete" busy={busy} onConfirm={onConfirm} onCancel={onCancel} />);
    return { onCancel, onConfirm };
  }

  it("cancels from the button, Escape or the backdrop while nothing is running", async () => {
    const user = userEvent.setup();
    const { onCancel } = renderConfirm(false);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onCancel).toHaveBeenCalledTimes(3);
  });

  it("holds still while its action runs: Cancel is disabled, and Escape and the backdrop do nothing", async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderConfirm(true);
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Working..." })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.keyboard("{Escape}");
    fireEvent.mouseDown(screen.getByRole("dialog"));
    expect(onCancel).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
