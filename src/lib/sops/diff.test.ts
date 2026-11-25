// Pins the line comparison behind "Compare with current": unchanged lines stay in order, a line
// only in the older version reads as removed, a line only in the newer one as added.
import { describe, expect, it } from "vitest";
import { diffLines } from "./diff.ts";

describe("diffLines", () => {
  it("marks a changed line as one removed and one added", () => {
    expect(diffLines(["a", "b"], ["a", "c"])).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "c" },
    ]);
  });
  it("keeps the longest run of shared lines", () => {
    const out = diffLines(["Purpose", "Walk the site", "Checks"], ["Purpose", "Confirm scope", "Walk the site", "Checks"]);
    expect(out.map((l) => l.kind)).toEqual(["same", "added", "same", "same"]);
  });
  it("reads two empty versions as no lines", () => {
    expect(diffLines([], [])).toEqual([]);
  });
  it("reads everything as added against an empty older version", () => {
    expect(diffLines([], ["x", "y"]).every((l) => l.kind === "added")).toBe(true);
  });
});
