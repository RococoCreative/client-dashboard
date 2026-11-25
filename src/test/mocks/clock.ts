// A clock for the mocks that never gives the same moment twice, as the database's clock_timestamp()
// does not, so a sign-off and the task copy it opens are always in order even in one millisecond.
let last = 0;

export function clockNow(): string {
  last = Math.max(Date.now(), last + 1);
  return new Date(last).toISOString();
}
