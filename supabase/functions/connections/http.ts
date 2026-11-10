// Helpers both the OAuth routes and the sync routes use: the error a route throws, the platform's
// keys, CORS, reading a provider's answer, a constant-time compare, who is calling, and the
// service client. Nothing here reads a token; index.ts and sync.ts do that, and sync.ts imports
// this file rather than index.ts, which starts the server when it loads.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
export const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export async function readJson<T>(response: Response, what: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    console.error(`${what} failed with ${response.status}`);
    throw new HttpError(502, `${what} was refused by the provider.`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, `${what} returned something unexpected.`);
  }
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// The signed-in caller, with a client that acts as them under the same row level security the
// app lives under.
export async function signedInUser(req: Request): Promise<{ jwt: string; userId: string; asUser: SupabaseClient }> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "Sign in first.");
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await asUser.auth.getUser(jwt);
  if (userError || !userData.user) throw new HttpError(401, "Sign in first.");
  return { jwt, userId: userData.user.id, asUser };
}

// The signed-in person, checked as an active admin (owner or admin) of the company, or a Rococo
// admin, through their own JWT and the same row level security the app lives under. Returns their
// profile id. A person's own profile row reads back even after they are deactivated, so is_active
// is checked here the way every database helper checks it (0013's kill switch): a departed
// admin's session cannot connect, disconnect, or read the company's accounts.
export async function requireAdmin(req: Request, companyId: string): Promise<string> {
  const { userId, asUser } = await signedInUser(req);
  const { data: profile } = await asUser.from("profiles").select("id, role, company_id, is_rococo_admin, is_active").eq("user_id", userId).maybeSingle();
  const allowed =
    Boolean(profile) &&
    profile!.is_active === true &&
    (profile!.is_rococo_admin || ((profile!.role === "owner" || profile!.role === "admin") && profile!.company_id === companyId));
  if (!allowed) throw new HttpError(403, "Only a company admin can manage connections.");
  return profile!.id as string;
}

export const service = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
