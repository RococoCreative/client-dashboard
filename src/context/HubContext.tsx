// The signed-in world: who you are, which company you are looking at, and what you may do
// there. Members have exactly one company. Rococo admins start with none: they land on the
// portfolio and step into a company deliberately, for this session only (nothing is
// persisted, so every sign-in starts at the portfolio). Every page reads the active company
// from here, so the same pages serve a Klasik owner and Austin looking at Klasik.
import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";
import type { Company, Profile } from "../types/database.ts";

export interface HubValue {
  session: Session;
  profile: Profile;
  // Null for a Rococo admin on the portfolio (no company chosen yet).
  company: Company | null;
  companies: Company[];
  isRococo: boolean;
  // May manage the active company: company admins of it, and Rococo admins anywhere.
  isAdmin: boolean;
  // Rococo admins only: enter a company, or null to return to the portfolio.
  setActiveCompanyId: (id: string | null) => void;
  refreshProfile: () => Promise<void>;
  refreshCompanies: () => Promise<void>;
}

// Rendered directly as the provider: <HubContext value={...}>.
export const HubContext = createContext<HubValue | null>(null);

export function useHub(): HubValue {
  const value = useContext(HubContext);
  if (!value) throw new Error("useHub must be used inside HubProvider.");
  return value;
}
