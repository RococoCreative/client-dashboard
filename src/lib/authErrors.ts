// Sign-in error copy. The signup gate rejects with a 403 whose message we wrote ourselves;
// the built-in mailer rate limits; everything else gets a plain retry line.
export function friendlyAuthError(err: unknown): string {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (/not set up for Company Hub/i.test(message)) return message;
  if (/signup|sign-ups|not allowed|disabled/i.test(message)) {
    return "That email is not set up yet. Ask your company admin for an invitation.";
  }
  if (/rate/i.test(message)) {
    return "Sign-in emails are limited right now. Wait a while and try again, or ask your admin for help.";
  }
  return message || "Could not send the sign-in link. Try again.";
}
