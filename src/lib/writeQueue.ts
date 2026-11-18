// One write queue per row, for the panels that send a whole row on every write (a scorecard cell,
// a KPI, a month's focus topic). Writes for one key run one after another, and each starts from
// the row the write ahead of it returned, so two quick edits never carry each other's old half.
// Once the last write in line settles the key is dropped: the next write then starts from the row
// as the page shows it, which may be newer than anything this queue wrote (a reload after a change
// made in another tab), instead of from a row this queue wrote minutes ago.
export function enqueueWrite<K, T>(
  chains: Map<K, Promise<T | undefined>>,
  key: K,
  work: (latest: T | undefined) => Promise<T>,
): Promise<T> {
  const before = chains.get(key) ?? Promise.resolve(undefined);
  const chained = before.then(work);
  // A failed write leaves nothing to build on, so the next one starts from the row as shown.
  const tail: Promise<T | undefined> = chained.catch(() => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return chained;
}
