// Display formatting and the money reader every money field and the CSV import share.
import { describe, expect, it } from "vitest";
import { displayName, formatMoney, formatPercent, formatPeriod, initials, moneyFieldError, moneyProblem, parseDate, parseMoney } from "./format.ts";

describe("format", () => {
  it("formats money and percentages with a hyphen for empties", () => {
    expect(formatMoney(1240000)).toBe("$1,240,000");
    expect(formatMoney(1240000, true)).toBe("$1.2M");
    expect(formatMoney(null)).toBe("-");
    expect(formatPercent(0.427)).toBe("43%");
    expect(formatPercent(null)).toBe("-");
  });

  it("parses date-only strings in local time", () => {
    const date = parseDate("2026-09-01");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(8);
    expect(date?.getDate()).toBe(1);
    expect(parseDate("garbage")).toBeNull();
  });

  it("formats periods with the year once when shared", () => {
    expect(formatPeriod("2026-09-01", "2026-09-30")).toBe("Sep 1 to Sep 30, 2026");
    expect(formatPeriod("2026-12-01", "2027-01-31")).toBe("Dec 1, 2026 to Jan 31, 2027");
  });

  it("derives names and initials", () => {
    expect(displayName({ full_name: " Jeff Klasik ", email: "j@x.com" })).toBe("Jeff Klasik");
    expect(displayName({ full_name: null, email: "j@x.com" })).toBe("j@x.com");
    expect(initials({ full_name: "Jeff Klasik", email: "j@x.com" })).toBe("JK");
    expect(initials({ full_name: "Cher", email: "c@x.com" })).toBe("C");
    expect(initials({ full_name: null, email: "jk@x.com" })).toBe("JK");
  });
});

describe("parseMoney", () => {
  it("reads accounting formats", () => {
    expect(parseMoney("$1,240,000.50")).toBe(1240000.5);
    expect(parseMoney("(500)")).toBe(-500);
    expect(parseMoney("-$20")).toBe(-20);
    expect(parseMoney("")).toBeNull();
    expect(parseMoney("n/a")).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
    expect(parseMoney("1 200")).toBe(1200);
  });
});

describe("money checks", () => {
  it("reads a unicode minus and a dollar sign outside parentheses", () => {
    expect(parseMoney("−500")).toBe(-500);
    expect(parseMoney("$(5)")).toBe(-5);
    expect(parseMoney("$ (1,000.25)")).toBe(-1000.25);
  });

  it("says why typed text will not save as a money figure", () => {
    expect(moneyProblem("")).toBeNull();
    expect(moneyProblem(undefined)).toBeNull();
    expect(moneyProblem("$12,000")).toBeNull();
    expect(moneyProblem("12.50")).toBeNull();
    expect(moneyProblem("12.500")).toBeNull();
    expect(moneyProblem("999999999999.99")).toBeNull();
    expect(moneyProblem("-999999999999")).toBeNull();
    expect(moneyProblem("12,OOO")).toBe("not_a_number");
    expect(moneyProblem("27 leads")).toBe("not_a_number");
    expect(moneyProblem("5%")).toBe("not_a_number");
    expect(moneyProblem("1e6")).toBe("not_a_number");
    expect(moneyProblem("1000000000000")).toBe("too_large");
    expect(moneyProblem("(1,000,000,000,000)")).toBe("too_large");
    expect(moneyProblem("123.456")).toBe("too_precise");
    expect(moneyProblem("1.234,56")).toBe("too_precise");
  });

  it("phrases a field message that says what to type", () => {
    expect(moneyFieldError("the budget", "12,OOO", "12000")).toBe("Enter the budget as a number, like 12000.");
    expect(moneyFieldError("the budget", "1000000000000", "12000")).toBe("Check the budget: the figure is too large to save.");
    expect(moneyFieldError("the budget", "1.005", "12000")).toBe("Enter the budget with at most two decimal places.");
    expect(moneyFieldError("the budget", "", "12000")).toBeNull();
    expect(moneyFieldError("the budget", "12000", "12000")).toBeNull();
  });
});
