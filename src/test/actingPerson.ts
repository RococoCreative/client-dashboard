// Who is acting in a test, for the mocks that judge who may do what (mocks/gsrOnDemand.ts). The
// mocks cannot see the React hub a page test renders, so renderWithHub records the hub's profile
// here, a mock unit test can set one directly, and src/test/setup.ts forgets it after every test.
// Nobody recorded means the mock falls back to the demo persona in the address (fixtures.personaIn).
import type { Profile } from "../types/database.ts";

let acting: Profile | null = null;

export function setActingPerson(profile: Profile | null): void {
  acting = profile;
}

export function actingPerson(): Profile | null {
  return acting;
}
