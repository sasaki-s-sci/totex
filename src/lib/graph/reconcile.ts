/**
 * Merges a freshly built list into the one React Flow is holding.
 *
 * React Flow owns its copies — it writes measurements and selection onto them —
 * so an element it already has is kept as it has it, and only the ones the
 * build actually rebuilt are handed over. When nothing was rebuilt the list
 * itself comes back unchanged, and React Flow is not disturbed at all.
 */
export function reconcile<T extends { id: string }>(
  current: T[],
  next: T[],
  /** The build this one replaces, which says what was actually rebuilt. */
  before: T[] | undefined,
  /** Moves what React Flow wrote onto its copy over to a rebuilt element. */
  carry: (rebuilt: T, holding: T) => T,
): T[] {
  const held = new Map(current.map((element) => [element.id, element] as const));
  const built = new Map((before ?? []).map((element) => [element.id, element] as const));

  let changed = current.length !== next.length;
  const merged = next.map((element, index) => {
    const holding = held.get(element.id);
    if (!holding) {
      changed = true;
      return element;
    }

    // The build handed back the very object it handed back last time, so
    // nothing about this element moved.
    if (holding === element || built.get(element.id) === element) {
      if (current[index] !== holding) changed = true;
      return holding;
    }

    changed = true;
    return carry(element, holding);
  });

  return changed ? merged : current;
}
