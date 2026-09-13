import { useCallback, useState } from "react";

export function useJunctionView() {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());

  // Ids carry the repository, so dev/ shut in one repository says nothing about another.
  const toggleJunction = useCallback((junction: string) => {
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(junction)) next.add(junction);
      return next;
    });
  }, []);

  return { closed, toggleJunction };
}
