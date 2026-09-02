// Tenant theme registry. The CSS for each preset lives in src/index.css under
// [data-theme="key"]; this module is the typed list (labels, light/dark, the accent the
// browser chrome shows) and the one place that flips the attribute on <html>. The login
// screen applies a company's theme the moment its domain is recognized, so the app feels
// like that company's tool before the magic link is even sent.
//
// Brand faces load from Adobe Fonts through the web project stylesheet in index.html
// (Rococo's Goldenbook and Halcom today). RBA's Proxima Nova and Helvetica Neue LT Pro are
// Adobe families too: add them to that web project and the RBA theme renders them with no
// code change; until then its stacks fall back to Helvetica Neue and Arial by design.
import type { ThemeKey } from "../types/database.ts";

export interface ThemePreset {
  key: ThemeKey;
  label: string;
  description: string;
  mode: "light" | "dark";
  accent: string;
}

export const THEMES: Record<ThemeKey, ThemePreset> = {
  rococo: {
    key: "rococo",
    label: "Rococo",
    description: "Forest and sand on paper. The default, the login screen, and the Rococo view.",
    mode: "light",
    accent: "#39443C",
  },
  klasik: {
    key: "klasik",
    label: "Klasik",
    description: "Copper on near-black with light Inter type.",
    mode: "dark",
    accent: "#BB7958",
  },
  kingdom: {
    key: "kingdom",
    label: "Kingdom",
    description: "Charcoal, copper, and sage on warm white. Josefin Sans.",
    mode: "light",
    accent: "#A76539",
  },
  rba: {
    key: "rba",
    label: "RBA",
    description: "Brand blue on deep charcoal with warm white type.",
    mode: "dark",
    accent: "#1C6EF4",
  },
};

export const THEME_KEYS = Object.keys(THEMES) as ThemeKey[];
export const DEFAULT_THEME: ThemeKey = "rococo";

export function isThemeKey(value: unknown): value is ThemeKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(THEMES, value);
}

export function resolveTheme(value: unknown): ThemeKey {
  return isThemeKey(value) ? value : DEFAULT_THEME;
}

// Sets the active theme on the document and keeps the browser chrome color in step.
// Returns the key actually applied so callers can render against it.
export function applyTheme(value: unknown): ThemeKey {
  const key = resolveTheme(value);
  if (typeof document === "undefined") return key;
  document.documentElement.dataset.theme = key;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEMES[key].accent);
  return key;
}
