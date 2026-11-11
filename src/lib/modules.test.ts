// Pins the module gate: the six known keys, how a company's raw module list is read (unknown
// keys ignored, a missing column reads as off), and the pure toggle the Rococo checkboxes use.
import { describe, expect, it } from "vitest";
import type { Company } from "../types/database.ts";
import { MODULE_DESCRIPTIONS, MODULE_KEYS, MODULE_LABELS, enabledModules, hasModule, isModuleKey, withModule } from "./modules.ts";

describe("MODULE_KEYS", () => {
  it("lists the six modules in order", () => {
    expect(MODULE_KEYS).toEqual(["switchboard", "production", "wins", "data_sources", "external_links", "tasks"]);
  });

  it("has tasks as a module key with a label and a description", () => {
    expect(isModuleKey("tasks")).toBe(true);
    expect(MODULE_LABELS.tasks).toBe("Tasks");
    expect(MODULE_DESCRIPTIONS.tasks).toBe("Tasks assigned to people, with due dates, steps, and repeats, and the tasks behind each marketing campaign.");
  });

  it("gives every key a label and a description without an em dash", () => {
    for (const key of MODULE_KEYS) {
      expect(MODULE_LABELS[key]).toBeTruthy();
      expect(MODULE_DESCRIPTIONS[key]).toBeTruthy();
      expect(MODULE_LABELS[key]).not.toContain("\u2014");
      expect(MODULE_DESCRIPTIONS[key]).not.toContain("\u2014");
    }
  });
});

describe("isModuleKey", () => {
  it("accepts a known key exactly", () => {
    expect(isModuleKey("wins")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isModuleKey("sectioned_nav")).toBe(false);
    expect(isModuleKey("Wins")).toBe(false);
    expect(isModuleKey("")).toBe(false);
  });
});

describe("hasModule", () => {
  it("is false with no company", () => {
    expect(hasModule(null, "wins")).toBe(false);
    expect(hasModule(undefined, "wins")).toBe(false);
  });

  it("reads the company's list", () => {
    expect(hasModule({ modules: [] }, "wins")).toBe(false);
    expect(hasModule({ modules: ["wins"] }, "wins")).toBe(true);
    expect(hasModule({ modules: ["wins"] }, "production")).toBe(false);
  });

  it("matches keys exactly and ignores unknown ones", () => {
    expect(hasModule({ modules: ["Wins"] }, "wins")).toBe(false);
    expect(hasModule({ modules: ["future", "wins"] }, "wins")).toBe(true);
  });

  it("reads a row fetched without the column as off", () => {
    expect(hasModule({} as Pick<Company, "modules">, "wins")).toBe(false);
  });
});

describe("enabledModules", () => {
  it("returns the known keys once each, in MODULE_KEYS order", () => {
    expect(enabledModules({ modules: ["wins", "future", "switchboard", "wins"] })).toEqual(["switchboard", "wins"]);
  });

  it("is empty with no company", () => {
    expect(enabledModules(null)).toEqual([]);
  });
});

describe("withModule", () => {
  it("adds a key and keeps unknown keys", () => {
    expect(withModule(["future"], "wins", true)).toEqual(["future", "wins"]);
  });

  it("never duplicates a key", () => {
    expect(withModule(["wins"], "wins", true)).toEqual(["wins"]);
  });

  it("removes a key, every copy of it, and keeps unknown keys", () => {
    expect(withModule(["wins", "future"], "wins", false)).toEqual(["future"]);
    expect(withModule(["wins", "wins"], "wins", false)).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = ["wins", "future"];
    withModule(input, "wins", false);
    withModule(input, "production", true);
    expect(input).toEqual(["wins", "future"]);
  });
});
