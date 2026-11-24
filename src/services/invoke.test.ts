// Pins what invokeFunction hands its callers when the Edge Function call fails: the HTTP status of
// the answer (null when no answer came back at all), beside the line it has always surfaced, so a
// service can choose which lines to show by status rather than by whatever text came back.
import { describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({ answer: { data: null, error: null } as { data: unknown; error: unknown } }));
vi.mock("./supabase.ts", () => ({ db: () => ({ functions: { invoke: async () => fake.answer } }), isSupabaseConfigured: true }));

import { FunctionCallError, invokeFunction } from "./invoke.ts";

const answered = (status: number, body: unknown) => ({ data: null, error: { context: new Response(JSON.stringify(body), { status }) } });

describe("invokeFunction", () => {
  it("returns the data of a 2xx answer", async () => {
    fake.answer = { data: { ok: true }, error: null };
    expect(await invokeFunction("connections/x", {})).toEqual({ ok: true });
  });

  it("throws a FunctionCallError with the answer's status and its error line", async () => {
    fake.answer = answered(410, { error: "Some line." });
    const err = await invokeFunction("connections/x", {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FunctionCallError);
    expect(err).toMatchObject({ status: 410, message: "Some line." });
  });

  it("has no status and the no-answer line when nothing came back", async () => {
    for (const error of [{ message: "Failed to send a request to the Edge Function" }, { context: new TypeError("Failed to fetch") }]) {
      fake.answer = { data: null, error };
      const err = await invokeFunction("connections/x", {}).catch((e: unknown) => e);
      expect(err).toMatchObject({ status: null, message: "The connection service did not answer. Try again in a moment." });
    }
  });

  it("keeps the status when the answer is not JSON", async () => {
    fake.answer = { data: null, error: { context: new Response("<html>Bad gateway</html>", { status: 502 }) } };
    const err = await invokeFunction("connections/x", {}).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, message: "The connection service did not answer. Try again in a moment." });
  });
});
