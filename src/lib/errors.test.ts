// The friendly line a page shows for what a service threw: a raw database sentence is for us,
// not for the person reading it.
import { describe, expect, it } from "vitest";
import { FALLBACK_MESSAGE, NOT_CHANGED_MESSAGE, errorMessage, requireRows } from "./errors.ts";

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

describe("raw database and provider text", () => {
  it("gives the fallback for a sentence that names tables, columns, the schema or a URL", () => {
    for (const err of [
      { message: 'relation "public.x" does not exist', code: "42P01" },
      { message: "permission denied for table connection_tokens", code: "42501" },
      { message: "Could not find the table 'public.rococo_admins' in the schema cache", code: "PGRST205" },
      new Error("error sending request for url (https://quickbooks.api.intuit.com/v3/company/123/query)"),
      { message: 'column "nope" does not exist', code: "42703" },
      { message: "syntax error at or near \"select\"" },
      { message: 'invalid input syntax for type uuid: "abc"', code: "22P02" },
      { message: "JWT expired", code: "PGRST301" },
      { message: "Something odd happened", code: "PGRST000" },
      { message: "Something odd happened", code: "42883" },
    ]) {
      expect(errorMessage(err)).toBe(FALLBACK_MESSAGE);
    }
  });

  it("keeps the friendly line for a value the database would not take", () => {
    expect(errorMessage({ message: 'null value in column "email" violates not-null constraint' })).toBe(
      "Some of that will not save as entered. Check the values and try again.",
    );
  });

  it("keeps the line for a row that is not there, even with its PostgREST code", () => {
    expect(errorMessage({ message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" })).toBe(
      "That is not here any more, or it is not yours to open.",
    );
  });

  it("passes the app's own refusals through as written", () => {
    for (const err of [
      { message: "The last Rococo admin cannot be removed.", code: "23514" },
      { message: "Rococo admins are added and removed on the Permissions page.", code: "P0001" },
      { message: "A Rococo admin entry is removed and added again, never edited.", code: "P0001" },
    ]) {
      expect(errorMessage(err)).toBe(err.message);
    }
  });

  it("says which addresses go on the Rococo admin list when the database refuses one", () => {
    expect(
      errorMessage({
        message: 'new row for relation "rococo_admins" violates check constraint "rococo_admins_email_check"',
        code: "23514",
      }),
    ).toBe("Use a rocococreative.io address.");
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
