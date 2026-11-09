// Opening a signed file has to work in a real browser, where window.open hands back null
// whenever "noopener" is asked for even though the tab opens. These pin the handle the
// helper needs, and that the new tab cannot reach back to this one.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openSignedUrl } from "./newTab.ts";

type FakeTab = { opener: unknown; location: { replace: ReturnType<typeof vi.fn> }; close: ReturnType<typeof vi.fn> };

function fakeTab(): FakeTab {
  return { opener: window, location: { replace: vi.fn() }, close: vi.fn() };
}

// What browsers do: a "noopener" request opens the tab but returns null.
function stubOpen(tab: FakeTab | null) {
  return vi.spyOn(window, "open").mockImplementation((_url, _target, features) => {
    if (typeof features === "string" && /noopener|noreferrer/i.test(features)) return null;
    return tab as unknown as Window;
  });
}

afterEach(() => vi.restoreAllMocks());

describe("openSignedUrl", () => {
  it("puts the signed URL into the tab it opened and cuts the opener link", async () => {
    const tab = fakeTab();
    stubOpen(tab);
    await openSignedUrl(async () => "https://files.example.com/signed");
    expect(tab.location.replace).toHaveBeenCalledWith("https://files.example.com/signed");
    expect(tab.opener).toBeNull();
    expect(tab.close).not.toHaveBeenCalled();
  });

  it("closes the tab when the URL cannot be fetched", async () => {
    const tab = fakeTab();
    stubOpen(tab);
    await expect(openSignedUrl(async () => Promise.reject(new Error("The connection dropped.")))).rejects.toThrow(
      "The connection dropped.",
    );
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.replace).not.toHaveBeenCalled();
  });

  it("says pop-ups are blocked when the browser refuses the tab", async () => {
    stubOpen(null);
    await expect(openSignedUrl(async () => "https://files.example.com/signed")).rejects.toThrow(/Allow pop-ups/);
  });
});
