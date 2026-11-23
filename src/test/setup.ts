// Vitest setup: jest-dom matchers and a fixed clock. The suite runs with no Supabase env vars
// (blanked in vite.config.ts) so nothing here ever touches the network.
//
// The fixtures describe one particular moment, September 2026: that is the open cycle, that is
// the year the company goals and KPIs are filed under. Pages read the current year from the
// clock to decide what to show, so a suite running on the real clock only agrees with its own
// fixtures until the end of 2026, then turns red on New Year's Day having changed nothing. So
// the tests run at the moment the fixtures describe. Only Date is faked; timers stay real, or
// Testing Library's waits would never resolve.
import "@testing-library/jest-dom";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { resetMockCapabilities } from "./mocks/capabilities.ts";
import { resetMockConnectorRequests } from "./mocks/connectorRequests.ts";
import { resetMockGsrs } from "./mocks/gsrOnDemand.ts";
import { resetMockInvitationEmail } from "./mocks/invitations.ts";
import { setActingPerson } from "./actingPerson.ts";

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-09-15T12:00:00.000Z") });
});

// Capability overrides, standalone GSRs, a company put on demand, an invitation email told to fail,
// tool requests and the acting person a test rendered or set do not leak into the next test.
afterEach(() => {
  resetMockCapabilities();
  resetMockConnectorRequests();
  resetMockGsrs();
  resetMockInvitationEmail();
  setActingPerson(null);
});

afterAll(() => {
  vi.useRealTimers();
});
