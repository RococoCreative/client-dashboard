// Pins the reading contrast of the two text tokens that sit on every surface: the tertiary ink
// and the link color. Each tenant theme must clear WCAG AA (4.5:1) on its page and card colors.
import { describe, expect, it } from "vitest";

// A non-literal specifier keeps node:fs out of the app's type check, which has no Node types. The
// path resolves from this file's own location, never the process cwd.
const fsModule = "node:fs";
const { readFileSync } = (await import(/* @vite-ignore */ fsModule)) as { readFileSync(path: URL, encoding: "utf8"): string };
const here = import.meta.url;
const css = readFileSync(new URL("../index.css", here), "utf8");

function themeTokens(theme: string): Record<string, string> {
  const start = css.indexOf(`[data-theme="${theme}"] {`);
  const end = css.indexOf("}", start);
  const tokens: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/--t-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens[m[1]] = m[2];
  return tokens;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(["rococo", "klasik", "kingdom", "rba"])("%s theme contrast", (theme) => {
  const t = themeTokens(theme);
  it.each([
    ["ink-3", "surface"],
    ["ink-3", "bg"],
    ["link", "surface"],
    ["link", "bg"],
  ])("%s on %s is at least 4.5:1", (fg, bg) => {
    expect(t[fg], `--t-${fg} is defined`).toBeDefined();
    expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(4.5);
  });
});
