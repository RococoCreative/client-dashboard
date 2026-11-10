// The mocked data layer mirrors the services: every function a service exports, its mock exports
// too, so a page test or the demo never meets a missing call. Read from the files themselves, so a
// new service function without its mock fails here rather than in whichever page first calls it.
// Only services with a mock module are compared (invoke.ts is a helper the services share).
import { describe, expect, it } from "vitest";

const services = import.meta.glob(["../../services/*.ts", "!../../services/*.test.ts"]);
const mocks = import.meta.glob(["./*.ts", "!./*.test.ts"]);

const name = (path: string) => path.split("/").pop()!.replace(/\.ts$/, "");
const mockByName = new Map(Object.entries(mocks).map(([path, load]) => [name(path), load]));

describe("mocks mirror the services", () => {
  for (const [path, loadService] of Object.entries(services)) {
    const loadMock = mockByName.get(name(path));
    if (!loadMock) continue;
    it(`${name(path)} exports every function the service does`, async () => {
      const service = (await loadService()) as Record<string, unknown>;
      const mock = (await loadMock()) as Record<string, unknown>;
      const missing = Object.keys(service).filter((key) => typeof service[key] === "function" && typeof mock[key] !== "function");
      expect(missing).toEqual([]);
    });
  }
});
