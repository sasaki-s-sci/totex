/** Insertion order is the contract: groups come back in the order of the list handed in. */
export function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const at = key(item);
    const bucket = grouped.get(at);
    if (bucket) {
      bucket.push(item);
    } else {
      grouped.set(at, [item]);
    }
  }
  return grouped;
}
