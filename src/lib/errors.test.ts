// The friendly line a page shows for what a service threw: a raw database sentence is for us,
// not for the person reading it.
import { describe, expect, it } from "vitest";
import { NOT_CHANGED_MESSAGE, errorMessage, requireRows } from "./errors.ts";

describe("errorMessage", () => {
  it("says a figure is too large instead of repeating the database", () => {
    expect(errorMessage({ message: "numeric field overflow" })).toBe("One of the figures is too large to save. Check for extra digits.");
    expect(errorMessage(new Error('value "99999999999" is out of range for type integer'))).toBe("One of the figures is too large to save. Check for extra digits.");
  });

  it("passes each GSR on demand refusal through as the line a person reads", () => {
    for (const message of [
      "GSRs on demand are not turned on for this company.",
      "This person already has two GSRs open. Mark the earlier one done first.",
      "Your own GSR is marked done and reopened by someone who leads you.",
      "This GSR is done. Reopen it to change its goals.",
      "This GSR is done. Reopen it to change its notes.",
      "That GSR is done, so its goals take no new tasks.",
    ]) {
      expect(errorMessage({ message })).toBe(message);
      expect(errorMessage(new Error(message))).toBe(message);
    }
  });

  it("passes the refusal of deleting one's own done GSR through as written", () => {
    const message = "Your own GSR stays once it is done. Someone who leads you can delete it.";
    expect(errorMessage({ message, code: "23514" })).toBe(message);
    expect(errorMessage(new Error(message))).toBe(message);
  });

  it("leaves a message it does not recognise as it is", () => {
    expect(errorMessage({ message: "This pillar is part of a signed-off review." })).toBe("This pillar is part of a signed-off review.");
  });
});

describe("requireRows", () => {
  it("passes rows through", () => {
    expect(requireRows([{ id: "a" }])).toEqual([{ id: "a" }]);
  });
  it("throws the plain message when nothing changed", () => {
    expect(() => requireRows([])).toThrow(NOT_CHANGED_MESSAGE);
    expect(() => requireRows(null)).toThrow(NOT_CHANGED_MESSAGE);
  });
});
