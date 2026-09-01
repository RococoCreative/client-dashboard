// Supabase client (auth, data, storage).
//
// Progressive and safe by default: when the env vars are absent (local dev without a
// .env, the test runner, or a deploy before keys are set) the client is null and the app
// renders a setup notice instead of the login gate. Data calls engage only once a real
// client exists, so nothing here can crash an unconfigured deployment, and the test suite
// stays hermetic with no mocked backend.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
// The anon (publishable) key: safe to ship in the browser. Real protection is the
// row-level security in supabase/migrations/.
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

// Services call this instead of the nullable export so a misuse before configuration is a
// clear message rather than a null dereference.
export function db(): SupabaseClient {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}
