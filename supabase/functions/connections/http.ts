// Helpers both the OAuth routes and the sync routes use: the error a route throws, the platform's
// keys, CORS, who is calling, and the service client. Nothing here reads a token; index.ts and
// sync.ts do that, and sync.ts imports this file rather than index.ts, which starts the server when
// it loads. The constant-time compare lives in _shared/bytes.ts.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { rococoAccountMatches, type RococoProfile } from "../_shared/rococoAdmin.ts";

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

interface SignedIn {
  jwt: string;
  userId: string;
  asUser: SupabaseClient;
  // The account's own address and whether it is confirmed, as the auth server holds them.
  email: string | null;
  emailConfirmed: boolean;
}

// The signed-in caller, with a client that acts as them under the same row level security the
// app lives under. The account is read from the auth server on this JWT, so its address and
// confirmation are auth.users' own, never anything the caller sends.
export async function signedInUser(req: Request): Promise<SignedIn> {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new HttpError(401, "Sign in first.");
  const asUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await asUser.auth.getUser(jwt);
  if (userError || !userData.user) throw new HttpError(401, "Sign in first.");
  const user = userData.user;
  return { jwt, userId: user.id, asUser, email: user.email ?? null, emailConfirmed: Boolean(user.email_confirmed_at) };
}

// The signed-in person's profile id. Who they are, not what they may do: a route that acts on a
// company checks that separately.
export async function signedInProfileId(req: Request): Promise<string> {
  const { userId, asUser } = await signedInUser(req);
  const { data: profile } = await asUser.from("profiles").select("id").eq("user_id", userId).maybeSingle();
  if (!profile) throw new HttpError(401, "Sign in first.");
  return profile.id as string;
}

// A Rococo admin exactly as the database defines one (private.is_rococo_admin, 0051): an active,
// flagged profile whose address is the account's own, confirmed, and is on the list. The flag
// alone is never enough. The list is read as the caller, and its row level security lets a row
// through only when the database's own check passes, so any doubt reads as no.
async function isRococoAdmin(signedIn: SignedIn, profile: RococoProfile): Promise<boolean> {
  if (!rococoAccountMatches(profile, signedIn)) return false;
  const { data, error } = await signedIn.asUser.from("rococo_admins").select("id").eq("email", (profile.email as string).toLowerCase()).maybeSingle();
  return !error && Boolean(data);
}

// The signed-in person, checked as an active admin (owner or admin) of the company, or a Rococo
// admin, through their own JWT and the same row level security the app lives under. Returns their
// profile id. A person's own profile row reads back even after they are deactivated, so is_active
// is checked here the way every database helper checks it (0013's kill switch): a departed
// admin's session cannot connect, disconnect, or read the company's accounts.
export async function requireAdmin(req: Request, companyId: string): Promise<string> {
  const signedIn = await signedInUser(req);
  const { data: profile } = await signedIn.asUser.from("profiles").select("id, role, company_id, is_rococo_admin, is_active, email").eq("user_id", signedIn.userId).maybeSingle();
  const companyAdmin = Boolean(profile) && profile!.is_active === true && (profile!.role === "owner" || profile!.role === "admin") && profile!.company_id === companyId;
  const allowed = companyAdmin || (Boolean(profile) && (await isRococoAdmin(signedIn, profile!)));
  if (!allowed) throw new HttpError(403, "Only a company admin can manage connections.");
  return profile!.id as string;
}

// The signed-in person, checked as an active member of the company (any role) or a Rococo admin,
// on their own JWT, with the same is_active and Rococo checks as requireAdmin. Returns their
// profile id.
export async function requireMember(req: Request, companyId: string): Promise<string> {
  const signedIn = await signedInUser(req);
  const { data: profile } = await signedIn.asUser.from("profiles").select("id, company_id, is_rococo_admin, is_active, email").eq("user_id", signedIn.userId).maybeSingle();
  const member = Boolean(profile) && profile!.is_active === true && profile!.company_id === companyId;
  const allowed = member || (Boolean(profile) && (await isRococoAdmin(signedIn, profile!)));
  if (!allowed) throw new HttpError(403, "Only someone at this company can see its connections.");
  return profile!.id as string;
}

export const service = () => createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
