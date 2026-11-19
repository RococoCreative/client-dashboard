// Pins that the phone hit areas are real layout, never an invisible box reaching into a neighbour:
// a chip is a 44px button with the pill drawn inside it, a rating row wraps under a finger instead
// of running off a phone screen, and no caller pastes a size on an icon button.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Chip from "./Chip.tsx";
import RatingInput from "./RatingInput.tsx";
import goalTasksSource from "../gsr/GoalTasks.tsx?raw";

const classes = (el: Element) => el.className.split(/\s+/);

describe("Chip", () => {
  it.each(["md", "sm"] as const)("is a %s pill drawn inside a 44px button under a finger, with no overlay", (size) => {
    render(<Chip size={size} active onClick={() => undefined}>Safety</Chip>);
    const chip = screen.getByRole("button", { name: "Safety" });
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(classes(chip)).toEqual(expect.arrayContaining(["tap:min-h-11", "tap:min-w-11"]));
    expect(chip.className).not.toMatch(/after:/);
    const pill = chip.firstElementChild as HTMLElement;
    expect(pill).toHaveTextContent("Safety");
    expect(classes(pill)).toEqual(expect.arrayContaining(["rounded-full", "border", "border-accent"]));
  });
});

describe("RatingInput", () => {
  it("lets a long scale wrap under a finger, keeping every step 44px", () => {
    render(<RatingInput value={null} max={10} label="Craft rating" onChange={() => undefined} />);
    const row = screen.getByRole("radiogroup", { name: "Craft rating" });
    expect(classes(row)).toContain("tap:flex-wrap");
    expect(classes(row)).not.toContain("flex-wrap");
    const steps = screen.getAllByRole("radio");
    expect(steps).toHaveLength(10);
    for (const step of steps) expect(classes(step)).toEqual(expect.arrayContaining(["tap:h-11", "tap:w-11"]));
  });
});

describe("icon button sizes", () => {
  it("are not pasted by GoalTasks", () => {
    expect(goalTasksSource).not.toMatch(/<IconButton[^>]*className="[^"]*\b[hw]-\d/);
  });
});
