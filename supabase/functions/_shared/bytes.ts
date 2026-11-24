// The one place the edge functions turn bytes into text and back, and compare secrets. Token
// sealing, the signed connect state and the connections helpers all import from here so there is
// a single base64url and a single constant-time compare. Decoders return null on anything
// malformed rather than throwing, so a caller decides what a bad value means.

// Base64url without padding: the form every sealed value and signed state uses.
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Strict base64url: the url alphabet only, no padding, and a length that can hold whole bytes.
export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  return decode(text.replace(/-/g, "+").replace(/_/g, "/"));
}

// For a secret pasted by hand: standard base64 or base64url, padded or not, with surrounding
// whitespace ignored. Anything else inside the value is refused.
export function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  const body = text.trim().replace(/=+$/, "");
  if (!/^[A-Za-z0-9+/_-]*$/.test(body) || body.length % 4 === 1) return null;
  return decode(body.replace(/-/g, "+").replace(/_/g, "/"));
}

// Equal length and equal content, without stopping at the first difference.
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function decode(standard: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(standard + "=".repeat((4 - (standard.length % 4)) % 4));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}
