// Which company a personal-email user picked on the login screen. The profile placed by an
// invitation is the source of truth; this hint only lets the holding screen name the
// company they meant when no invitation exists yet.
const KEY = "hub.loginCompanyHint";

export function storeLoginHint(slug: string): void {
  try {
    localStorage.setItem(KEY, slug);
  } catch {
    // Storage blocked: the hint is a nicety, nothing depends on it.
  }
}

export function readLoginHint(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
