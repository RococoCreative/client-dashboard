// Email helpers shared by the login screen and the People page. The domain is what maps
// an address to a company at sign-in (via company_domains); everything here is plain
// string work with no network so it is fully unit tested.
export const ROCOCO_DOMAIN = "rocococreative.io";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// "name@company.com" -> "company.com"; null when there is no usable domain part.
export function emailDomain(raw: string): string | null {
  const email = normalizeEmail(raw);
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1);
  return domain.includes(".") && !domain.includes(" ") ? domain : null;
}

export function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(raw));
}

export function isRococoEmail(raw: string): boolean {
  return emailDomain(raw) === ROCOCO_DOMAIN;
}

// Domain input on the Rococo admin screen: accepts "Company.com", "@company.com", or a
// pasted URL and returns the bare lowercase host, or null when it is not a domain.
export function normalizeDomain(raw: string): string | null {
  let value = raw.trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "").replace(/^@/, "").replace(/\/.*$/, "").replace(/^www\./, "");
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(value)) return null;
  return value;
}
