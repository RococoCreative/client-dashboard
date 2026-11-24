// The one kind of error whose text a sync may show. The adapters, the token store and the sync
// store throw SyncError with a fixed line of the hub's own; anything else (a database's text, a
// runtime's, a provider's, a JSON parse error) is never shown, and the caller's fallback line is
// used instead. The run outcome, the source's last_error and the describe answer all go through
// syncMessage, so the screen only ever shows a line written here in the code.

export class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncError";
  }
}

// The describe route's line for anything that is not a sync's own.
export const SHEET_NOT_READ = "The sheet could not be read. Check it is shared with the connected account.";

export function syncMessage(err: unknown, fallback: string): string {
  return err instanceof SyncError && err.message ? err.message : fallback;
}
