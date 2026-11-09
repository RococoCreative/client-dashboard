// The one way the app calls an Edge Function. An internal helper for the services that talk to
// the connections function: it has no mock and no demo alias, because only a service imports
// it, and every service that does is mocked whole.
import { db } from "./supabase.ts";

// The Edge Function answers errors as JSON with a plain message; surface that line rather than
// the generic "non-2xx status code" the client library reports.
export async function invokeFunction<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await db().functions.invoke<T>(path, { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    const message = await context
      ?.clone()
      .json()
      .then((body: { error?: string } | undefined) => body?.error ?? "")
      .catch(() => "");
    throw new Error(message || "The connection service did not answer. Try again in a moment.");
  }
  return data as T;
}
