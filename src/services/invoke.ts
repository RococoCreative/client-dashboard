// The one way the app calls an Edge Function. An internal helper for the services that talk to
// the connections function: it has no mock and no demo alias, because only a service imports
// it, and every service that does is mocked whole.
import { db } from "./supabase.ts";

const NO_ANSWER = "The connection service did not answer. Try again in a moment.";

// A refused or failed call: the line the answer carried (or the no-answer line), and the HTTP
// status of the answer, null when no answer came back at all. The line is whatever the answer
// said, which a gateway in front of the function can write too, so a service that must show only
// its own lines chooses them by status (services/connections.ts).
export class FunctionCallError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "FunctionCallError";
    this.status = status;
  }
}

// The Edge Function answers errors as JSON with a plain message; surface that line rather than
// the generic "non-2xx status code" the client library reports.
export async function invokeFunction<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke<T>(path, { body });
  if (error) {
    // An HTTP answer comes as a Response; a request that never got one carries the fetch error, or nothing.
    const context = (error as { context?: unknown }).context;
    const response = context instanceof Response ? context : null;
    const message = response
      ? await response
          .clone()
          .json()
          .then((answer: { error?: unknown } | undefined) => (typeof answer?.error === "string" ? answer.error : ""))
          .catch(() => "")
      : "";
    throw new FunctionCallError(message || NO_ANSWER, response ? response.status : null);
  }
  return data as T;
}
