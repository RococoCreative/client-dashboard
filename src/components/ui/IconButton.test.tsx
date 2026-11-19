// Pins that the icon button and the icon link own their size: 36px with a mouse, 44px on a phone
// or under a finger, so no caller pastes its own size on top. The small size keeps its drawn
// pill but reaches 44px of hit area under a finger.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import IconButton from "./IconButton.tsx";
import IconLink from "./IconLink.tsx";

const classes = (el: HTMLElement) => el.className.split(/\s+/);

describe("IconButton", () => {
  it("is 36px with a mouse and 44px on a phone or a coarse pointer", () => {
    render(<IconButton label="Edit goal">x</IconButton>);
    const button = screen.getByRole("button", { name: "Edit goal" });
    expect(button).toHaveAttribute("title", "Edit goal");
    expect(classes(button)).toEqual(expect.arrayContaining(["h-9", "w-9", "tap:h-11", "tap:w-11"]));
    expect(classes(button)).not.toContain("h-8");
  });

  it("keeps the small size at 24px with a mouse and makes it a real 44px box under a finger", () => {
    render(<IconButton size="sm" label="Remove example.com">x</IconButton>);
    const button = screen.getByRole("button", { name: "Remove example.com" });
    expect(classes(button)).toEqual(expect.arrayContaining(["h-6", "w-6", "tap:h-11", "tap:w-11"]));
    // No invisible box reaching past the button into its neighbours.
    expect(button.className).not.toMatch(/after:/);
  });
});

describe("IconLink", () => {
  it("is a named link with the icon button's look and size", () => {
    render(
      <MemoryRouter>
        <IconLink to="/sops/1/edit" label="Edit SOP">x</IconLink>
      </MemoryRouter>,
    );
    const link = screen.getByRole("link", { name: "Edit SOP" });
    expect(link).toHaveAttribute("href", "/sops/1/edit");
    expect(link).toHaveAttribute("title", "Edit SOP");
    expect(classes(link)).toEqual(expect.arrayContaining(["h-9", "w-9", "tap:h-11", "tap:w-11", "rounded-md"]));
  });
});
