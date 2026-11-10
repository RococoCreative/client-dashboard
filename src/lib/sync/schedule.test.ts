// Proves the weekly schedule: the latest slot at or before now in the source's own time zone,
// across daylight saving changes, and when a source is due.
import { describe, expect, it } from "vitest";
import { isDue, latestSlot, scheduleOf, type WeeklySchedule } from "../../../supabase/functions/_shared/sync/schedule.ts";

const S: WeeklySchedule = { weekday: 1, time: "07:00:00", timezone: "America/Chicago" };
const iso = (d: Date) => d.toISOString();
const at = (s: string) => new Date(s);

describe("scheduleOf", () => {
  it("needs all three parts", () => {
    expect(scheduleOf({ sync_weekday: null, sync_time: "07:00:00", sync_timezone: "America/Chicago" })).toBeNull();
    expect(scheduleOf({ sync_weekday: 1, sync_time: null, sync_timezone: "America/Chicago" })).toBeNull();
    expect(scheduleOf({ sync_weekday: 1, sync_time: "07:00:00", sync_timezone: null })).toBeNull();
    expect(scheduleOf({ sync_weekday: 1, sync_time: "07:00:00", sync_timezone: "America/Chicago" })).toEqual(S);
  });
});

describe("latestSlot", () => {
  it("finds this week's slot once it has passed, and last week's before", () => {
    expect(iso(latestSlot(S, at("2026-11-09T14:00:00Z")))).toBe("2026-11-09T13:00:00.000Z");
    expect(iso(latestSlot(S, at("2026-11-09T13:00:00Z")))).toBe("2026-11-09T13:00:00.000Z");
    expect(iso(latestSlot(S, at("2026-11-09T12:59:00Z")))).toBe("2026-11-02T13:00:00.000Z");
  });

  it("keeps the local time across the fall-back change", () => {
    expect(iso(latestSlot(S, at("2026-10-27T00:00:00Z")))).toBe("2026-10-26T12:00:00.000Z");
    expect(iso(latestSlot(S, at("2026-11-03T00:00:00Z")))).toBe("2026-11-02T13:00:00.000Z");
  });

  it("moves a time in the spring-forward gap to the first valid instant after it", () => {
    const gap: WeeklySchedule = { weekday: 0, time: "02:30", timezone: "America/Chicago" };
    expect(iso(latestSlot(gap, at("2027-03-14T12:00:00Z")))).toBe("2027-03-14T08:00:00.000Z");
  });

  it("takes the earlier of a time that happens twice when the clocks fall back", () => {
    const overlap: WeeklySchedule = { weekday: 0, time: "01:30", timezone: "America/Chicago" };
    expect(iso(latestSlot(overlap, at("2026-11-01T12:00:00Z")))).toBe("2026-11-01T06:30:00.000Z");
    expect(iso(latestSlot(overlap, at("2026-11-01T07:00:00Z")))).toBe("2026-11-01T06:30:00.000Z");
  });

  it("works in UTC", () => {
    const utc: WeeklySchedule = { weekday: 3, time: "09:15:00", timezone: "UTC" };
    expect(iso(latestSlot(utc, at("2026-11-11T09:15:00Z")))).toBe("2026-11-11T09:15:00.000Z");
  });
});

describe("isDue", () => {
  const now = at("2026-11-09T14:00:00Z");
  const base = { enabled: true, sync_weekday: 1, sync_time: "07:00:00", sync_timezone: "America/Chicago", last_attempt_at: null };

  it("is never due when disabled or unscheduled", () => {
    expect(isDue({ ...base, enabled: false }, now)).toBe(false);
    expect(isDue({ ...base, sync_weekday: null, sync_time: null, sync_timezone: null }, now)).toBe(false);
  });

  it("is due when never tried or last tried before the latest slot", () => {
    expect(isDue(base, now)).toBe(true);
    expect(isDue({ ...base, last_attempt_at: "2026-11-09T12:00:00Z" }, now)).toBe(true);
    expect(isDue({ ...base, last_attempt_at: "2026-11-09T13:30:00Z" }, now)).toBe(false);
  });

  it("is never due, and never throws, in a zone the scheduler cannot read", () => {
    for (const sync_timezone of ["UTC+5", "Mars+3", "Mars/Olympus"]) {
      expect(() => isDue({ ...base, sync_timezone }, now)).not.toThrow();
      expect(isDue({ ...base, sync_timezone }, now)).toBe(false);
      expect(isDue({ ...base, sync_timezone, last_attempt_at: "2026-11-01T00:00:00Z" }, now)).toBe(false);
    }
  });
});
