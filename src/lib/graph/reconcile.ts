// React Flow writes measurements and selection onto its own copies, so an
// element it already holds is kept and only rebuilt ones are handed over.
export function reconcile<T extends { id: string }>(
  current: T[],
  next: T[],
  before: T[] | undefined,
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

    if (holding === element || built.get(element.id) === element) {
      if (current[index] !== holding) changed = true;
      return holding;
    }

    changed = true;
    return carry(element, holding);
  });

  return changed ? merged : current;
}
