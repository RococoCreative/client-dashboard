import { describe, expect, it } from "vitest";
import { applyTheme, isThemeKey, resolveTheme, THEME_KEYS } from "./theme.ts";

describe("theme registry", () => {
  it("knows the four presets and rejects anything else", () => {
    expect(THEME_KEYS).toEqual(["rococo", "klasik", "kingdom", "rba"]);
    expect(isThemeKey("kingdom")).toBe(true);
    expect(isThemeKey("toString")).toBe(false);
    expect(resolveTheme(null)).toBe("rococo");
    expect(resolveTheme("nope")).toBe("rococo");
  });

  it("flips the attribute on the document", () => {
    expect(applyTheme("klasik")).toBe("klasik");
    expect(document.documentElement.dataset.theme).toBe("klasik");
    expect(applyTheme(undefined)).toBe("rococo");
    expect(document.documentElement.dataset.theme).toBe("rococo");
  });
});
