// The line for a failure nobody can say more about.
export const FALLBACK_MESSAGE = "Something went wrong. Try again.";

// Turn whatever a service threw (a Supabase PostgrestError, an Error, a string) into one
// friendly sentence for the UI. Services throw, callers message; this is the message.
export function errorMessage(err: unknown, fallback = FALLBACK_MESSAGE): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  const code = codeOf(err);
  if (err instanceof Error && err.message) return friendly(err.message, code, fallback);
  if (typeof err === "object" && "message" in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === "string" && message) return friendly(message, code, fallback);
  }
  return fallback;
}

function codeOf(err: unknown): string {
  if (typeof err !== "object" || err === null || !("code" in err)) return "";
  const code = (err as { code?: unknown }).code;
  return typeof code === "string" ? code : "";
}

// Text that only the database, PostgREST or a provider writes: it names a table, a column, the
// schema, a token or a URL, and none of that is for the person reading it.
const RAW_TEXT: readonly RegExp[] = [
  /permission denied for /i,
  /\brelation "/i,
  /\bcolumn "/i,
  /schema cache/i,
  /syntax error/i,
  /invalid input syntax/i,
  /\bJWT\b/,
  /https?:\/\//i,
];

// A PostgREST code (other than "no row", which has its own line above) or a Postgres syntax,
// access or schema code (class 42, other than a row-level security refusal) is never a sentence
// the app wrote.
function isRaw(message: string, code: string): boolean {
  if (code.startsWith("PGRST") && code !== "PGRST116") return true;
  if (code.startsWith("42") && code !== "42501") return true;
  return RAW_TEXT.some((pattern) => pattern.test(message));
}

// Translate the Postgres phrasings people actually hit into plain language. A refusal the app
// wrote itself (a trigger's sentence) passes through as written; raw text gives the fallback.
function friendly(message: string, code: string, fallback: string): string {
  if (/row-level security/i.test(message)) return "You do not have permission to do that.";
  if (/duplicate key|already exists/i.test(message)) return "That already exists.";
  if (/violates foreign key/i.test(message)) return "Something still depends on this. Remove that first.";
  if (/Failed to fetch|NetworkError|network/i.test(message)) return "The connection dropped. Check your signal and try again.";
  // What PostgREST says when a single-row request matched nothing: the row is gone, or RLS is
  // hiding it. Either way the page asked for something it cannot have, and the raw sentence
  // names internals the reader has no use for.
  if (/JSON object requested|multiple \(or no\) rows|PGRST116/i.test(message)) {
    return "That is not here any more, or it is not yours to open.";
  }
  // Every money column is numeric(14,2). A figure past it fails the whole save, a CSV import
  // included, with a sentence that names neither the field nor the fix.
  if (/numeric field overflow|is out of range for type/i.test(message)) {
    return "One of the figures is too large to save. Check for extra digits.";
  }
  // The Rococo admin list takes only Rococo's own addresses (0051). The app checks first, so this
  // is the database holding the same line.
  if (/rococo_admins_email_check/.test(message)) return "Use a rocococreative.io address.";
  // A constraint the database rejected: the name is for us, not for the person reading it.
  if (/violates check constraint|violates not-null constraint/i.test(message)) {
    return "Some of that will not save as entered. Check the values and try again.";
  }
  if (isRaw(message, code)) return fallback;
  return message;
}

// A delete or bulk update that RLS filtered out, or that found the row already gone, returns no
// error and no rows. Services that change a known row ask for the ids back and pass them here,
// so a refused change reads as a refusal instead of looking like it worked.
export const NOT_CHANGED_MESSAGE = "That is not here any more, or it is not yours to change.";

export function requireRows<T>(rows: readonly T[] | null | undefined, message = NOT_CHANGED_MESSAGE): T[] {
  if (!rows || rows.length === 0) throw new Error(message);
  return [...rows];
}
