// Turn whatever a service threw (a Supabase PostgrestError, an Error, a string) into one
// friendly sentence for the UI. Services throw, callers message; this is the message.
export function errorMessage(err: unknown, fallback = "Something went wrong. Try again."): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  if (err instanceof Error && err.message) return friendly(err.message);
  if (typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return friendly(message);
  }
  return fallback;
}

// Translate the Postgres phrasings people actually hit into plain language.
function friendly(message: string): string {
  if (/row-level security/i.test(message)) return "You do not have permission to do that.";
  if (/duplicate key|already exists/i.test(message)) return "That already exists.";
  if (/violates foreign key/i.test(message)) return "Something still depends on this. Remove that first.";
  if (/Failed to fetch|NetworkError|network/i.test(message)) return "The connection dropped. Check your signal and try again.";
  return message;
}
