// useIsWide: wide when matchMedia is missing, the query's answer on first render, and an update
// when the media query changes (a resize or a rotation).
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useIsWide from "./useIsWide.ts";

function Probe() {
  return <p>{useIsWide() ? "wide" : "narrow"}</p>;
}

// A matchMedia whose answer a test flips, telling every listener.
function stubMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return matches;
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => query));
  return {
    set: (next: boolean) => {
      matches = next;
      listeners.forEach((fn) => fn());
    },
    listeners,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("useIsWide", () => {
  it("counts a screen with no matchMedia as wide", () => {
    vi.stubGlobal("matchMedia", undefined);
    render(<Probe />);
    expect(screen.getByText("wide")).toBeInTheDocument();
  });

  it("reads the lg query on first render", () => {
    stubMedia(false);
    render(<Probe />);
    expect(screen.getByText("narrow")).toBeInTheDocument();
    expect(window.matchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
  });

  it("follows a resize or rotation, and lets go of the query on unmount", () => {
    const media = stubMedia(false);
    const { unmount } = render(<Probe />);
    expect(screen.getByText("narrow")).toBeInTheDocument();
    act(() => media.set(true));
    expect(screen.getByText("wide")).toBeInTheDocument();
    act(() => media.set(false));
    expect(screen.getByText("narrow")).toBeInTheDocument();
    unmount();
    expect(media.listeners.size).toBe(0);
  });
});
