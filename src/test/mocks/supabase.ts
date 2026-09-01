// In-memory stand-in for services/supabase.ts: reports configured, hands back a fake session
// for the persona in the URL, and never touches the network.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fakeSession, personaFromLocation } from "../fixtures.ts";

type Listener = (event: string, session: unknown) => void;
const listeners = new Set<Listener>();
// ?signedout=1 in the preview harness shows the sign-in screen instead of a session.
let signedOut = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("signedout");

const client = {
  auth: {
    getSession: async () => ({ data: { session: signedOut ? null : fakeSession(personaFromLocation().profile) }, error: null }),
    getUser: async () => ({ data: { user: fakeSession(personaFromLocation().profile).user }, error: null }),
    onAuthStateChange: (callback: Listener) => {
      listeners.add(callback);
      return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
    },
    signOut: async () => {
      signedOut = true;
      listeners.forEach((cb) => cb("SIGNED_OUT", null));
      return { error: null };
    },
    signInWithOtp: async () => ({ data: {}, error: null }),
  },
} as unknown as SupabaseClient;

export const isSupabaseConfigured = true;
export const supabase: SupabaseClient | null = client;
export function db(): SupabaseClient {
  return client;
}
