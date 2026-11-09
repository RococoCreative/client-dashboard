// The friendly line a page shows for what a service threw: a raw database sentence is for us,
// not for the person reading it.
import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors.ts";

describe("errorMessage", () => {
  it("says a figure is too large instead of repeating the database", () => {
    expect(errorMessage({ message: "numeric field overflow" })).toBe("One of the figures is too large to save. Check for extra digits.");
    expect(errorMessage(new Error('value "99999999999" is out of range for type integer'))).toBe("One of the figures is too large to save. Check for extra digits.");
  });

  it("leaves a message it does not recognise as it is", () => {
    expect(errorMessage({ message: "This pillar is part of a signed-off review." })).toBe("This pillar is part of a signed-off review.");
  });
});
