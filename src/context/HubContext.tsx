// The signed-in world: who you are, which company you are looking at, and what you may do
// there. Members have exactly one company. Rococo admins pick from all of them (remembered
// per browser) and every page reads the active company from here, so the same pages serve
// a Klasik owner and Austin looking at Klasik.
import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Company, Profile } from "../types/database.ts";

export interface HubValue {
  session: Session;
  profile: Profile;
  // Null only for a Rococo admin before any company exists.
  company: Company | null;
  companies: Company[];
  isRococo: boolean;
  // May manage the active company: company admins of it, and Rococo admins anywhere.
  isAdmin: boolean;
  setActiveCompanyId: (id: string) => void;
  refreshProfile: () => Promise<void>;
  refreshCompanies: () => Promise<void>;
}

const HubContext = createContext<HubValue | null>(null);

export const HubProvider = HubContext.Provider;

export function useHub(): HubValue {
  const value = useContext(HubContext);
  if (!value) throw new Error("useHub must be used inside HubProvider.");
  return value;
}

const ACTIVE_KEY = "hub.activeCompanyId";

export function readActiveCompanyId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function storeActiveCompanyId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // Private mode or blocked storage: the choice simply does not persist.
  }
}
