// The hub's public address. A link that leaves the app (an invitation passed on by email)
// must point at the production domain, never at whatever host the admin happens to be on: a
// Vercel preview or branch URL in an invitation lands the person on the wrong build, and a
// shared vercel.app address is what mail filters reject. VITE_APP_URL names the domain;
// without it (local dev, tests) the current origin stands in.
export function appOrigin(configured: string | undefined = import.meta.env.VITE_APP_URL): string {
  const value = configured?.trim();
  if (value) {
    try {
      return new URL(value).origin;
    } catch {
      // A malformed value falls back rather than producing broken links.
    }
  }
  return window.location.origin;
}
