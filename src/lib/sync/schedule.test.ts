// Proves the weekly schedule over a set of days: the latest slot at or before now in the source's
// own time zone, across daylight saving changes, and when a source is due.
import { describe, expect, it } from "vitest";
import { isDue, latestSlot, scheduleOf, type WeeklySchedule } from "../../../supabase/functions/_shared/sync/schedule.ts";

const S: WeeklySchedule = { weekdays: [1], time: "07:00:00", timezone: "America/Chicago" };
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
    const gap: WeeklySchedule = { weekdays: [0], time: "02:30", timezone: "America/Chicago" };
    expect(iso(latestSlot(gap, at("2027-03-14T12:00:00Z")))).toBe("2027-03-14T08:00:00.000Z");
  });

  it("takes the earlier of a time that happens twice when the clocks fall back", () => {
    const overlap: WeeklySchedule = { weekdays: [0], time: "01:30", timezone: "America/Chicago" };
    expect(iso(latestSlot(overlap, at("2026-11-01T12:00:00Z")))).toBe("2026-11-01T06:30:00.000Z");
    expect(iso(latestSlot(overlap, at("2026-11-01T07:00:00Z")))).toBe("2026-11-01T06:30:00.000Z");
  });

  it("works in UTC", () => {
    const utc: WeeklySchedule = { weekdays: [3], time: "09:15:00", timezone: "UTC" };
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

describe("a set of weekdays", () => {
  // Monday to Friday at 08:00 in New York. From 1 November 2026 that is 13:00 UTC.
  const weekdays = { enabled: true, sync_weekday: 1, sync_weekdays: [1, 2, 3, 4, 5], sync_time: "08:00:00", sync_timezone: "America/New_York" };
  const MON_RUN = "2026-11-09T13:07:00Z";
  const TUE_RUN = "2026-11-10T13:07:00Z";
  const FRI_RUN = "2026-11-13T13:07:00Z";

  it("reads the set, sorted, and falls back to the single day when the set is null", () => {
    expect(scheduleOf({ ...weekdays, sync_weekdays: [5, 1, 3] })).toEqual({ weekdays: [1, 3, 5], time: "08:00:00", timezone: "America/New_York" });
    expect(scheduleOf({ ...weekdays, sync_weekdays: null, sync_weekday: 4 })).toEqual({ weekdays: [4], time: "08:00:00", timezone: "America/New_York" });
  });

  it("is due on Tuesday at 08:07 when the last attempt was Monday 08:07", () => {
    expect(isDue({ ...weekdays, last_attempt_at: MON_RUN }, at(TUE_RUN))).toBe(true);
    expect(iso(latestSlot(scheduleOf(weekdays)!, at(TUE_RUN)))).toBe("2026-11-10T13:00:00.000Z");
  });

  it("is not due on Tuesday at 07:50 when the last attempt was Monday 08:07", () => {
    expect(isDue({ ...weekdays, last_attempt_at: MON_RUN }, at("2026-11-10T12:50:00Z"))).toBe(false);
  });

  it("is not due on Saturday or Sunday after Friday's run", () => {
    for (const now of ["2026-11-14T13:07:00Z", "2026-11-14T23:00:00Z", "2026-11-15T13:07:00Z", "2026-11-16T04:59:00Z", "2026-11-16T12:59:00Z"]) {
      expect(isDue({ ...weekdays, last_attempt_at: FRI_RUN }, at(now))).toBe(false);
      expect(iso(latestSlot(scheduleOf(weekdays)!, at(now)))).toBe("2026-11-13T13:00:00.000Z");
    }
  });

  it("is due on Monday at 08:07 after Friday's run", () => {
    expect(isDue({ ...weekdays, last_attempt_at: FRI_RUN }, at("2026-11-16T13:07:00Z"))).toBe(true);
  });

  it("makes one attempt per slot: not due again an hour after Tuesday's attempt", () => {
    expect(isDue({ ...weekdays, last_attempt_at: TUE_RUN }, at("2026-11-10T14:07:00Z"))).toBe(false);
    expect(isDue({ ...weekdays, last_attempt_at: TUE_RUN }, at("2026-11-11T12:59:00Z"))).toBe(false);
    expect(isDue({ ...weekdays, last_attempt_at: TUE_RUN }, at("2026-11-11T13:00:00Z"))).toBe(true);
  });

  it("a single day set behaves exactly as the weekly schedule did", () => {
    const single = { enabled: true, sync_weekday: 1, sync_time: "07:00:00", sync_timezone: "America/Chicago" };
    const instants = ["2026-10-26T11:00:00Z", "2026-10-26T12:00:00Z", "2026-11-02T12:59:00Z", "2026-11-02T13:00:00Z", "2026-11-09T14:00:00Z", "2026-11-12T00:00:00Z"];
    const attempts = [null, "2026-10-26T12:30:00Z", "2026-11-02T13:30:00Z", "2026-11-09T12:00:00Z"];
    for (const now of instants) {
      expect(iso(latestSlot(scheduleOf({ ...single, sync_weekdays: [1] })!, at(now)))).toBe(iso(latestSlot(S, at(now))));
      for (const last_attempt_at of attempts) {
        const before = isDue({ ...single, last_attempt_at }, at(now));
        expect(isDue({ ...single, sync_weekdays: [1], last_attempt_at }, at(now))).toBe(before);
        expect(isDue({ ...single, sync_weekdays: null, last_attempt_at }, at(now))).toBe(before);
      }
    }
  });

  it("picks the slot in the source's zone across a daylight saving change", () => {
    // New York leaves daylight time on Sunday 1 November 2026: Friday's 08:00 is 12:00 UTC and
    // Monday's is 13:00 UTC. At 12:30 UTC on Monday it is 07:30 there, so Monday's slot is still
    // ahead, though it would have passed at the old offset.
    expect(iso(latestSlot(scheduleOf(weekdays)!, at("2026-11-02T12:30:00Z")))).toBe("2026-10-30T12:00:00.000Z");
    expect(isDue({ ...weekdays, last_attempt_at: "2026-10-30T12:07:00Z" }, at("2026-11-02T12:30:00Z"))).toBe(false);
    expect(iso(latestSlot(scheduleOf(weekdays)!, at("2026-11-02T13:07:00Z")))).toBe("2026-11-02T13:00:00.000Z");
    expect(isDue({ ...weekdays, last_attempt_at: "2026-10-30T12:07:00Z" }, at("2026-11-02T13:07:00Z"))).toBe(true);
  });

  it("judges the weekday in the source's zone, not in UTC", () => {
    // 23:30 UTC on Sunday 8 November is 08:30 on Monday in Tokyo, so Monday's slot has passed.
    const tokyo = { ...weekdays, sync_timezone: "Asia/Tokyo" };
    expect(iso(latestSlot(scheduleOf(tokyo)!, at("2026-11-08T23:30:00Z")))).toBe("2026-11-08T23:00:00.000Z");
    expect(isDue({ ...tokyo, last_attempt_at: "2026-11-06T00:00:00Z" }, at("2026-11-08T23:30:00Z"))).toBe(true);
    // 23:30 UTC on Friday 6 November is 08:30 on Saturday in Tokyo: the latest slot is Friday's.
    expect(iso(latestSlot(scheduleOf(tokyo)!, at("2026-11-06T23:30:00Z")))).toBe("2026-11-05T23:00:00.000Z");
  });

  it("a source with no days is never due", () => {
    expect(scheduleOf({ ...weekdays, sync_weekdays: [] })).toBeNull();
    expect(isDue({ ...weekdays, sync_weekdays: [], last_attempt_at: null }, at(TUE_RUN))).toBe(false);
    expect(isDue({ ...weekdays, sync_weekdays: null, sync_weekday: null, last_attempt_at: null }, at(TUE_RUN))).toBe(false);
  });
});
