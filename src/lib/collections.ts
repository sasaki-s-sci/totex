/**
 * The one collection helper the app needs, kept where everything can reach it:
 * the layout buckets branches and worktrees by commit, the build buckets
 * sessions by repository and by branch, and the folder column buckets roots by
 * where they came from.
 *
 * Insertion order is the contract — a `Map` iterates in it — so a caller that
 * hands over an ordered list gets its groups back in that order.
 */
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
