import { useEffect, useMemo, useState } from "react";
import type { WorkRequest } from "../canvas/graphActions";
import { terminal, typing } from "../lib/keys";
import type { CardGroup } from "./groups";

/** The order is the board's vertical order, including empty worktrees outside the repository root. */
export function useCardOffers(groups: CardGroup[], open: (request: WorkRequest) => void) {
  const empty = useMemo(
    () => groups.flatMap((group) => group.cards).filter((card) => !card.sessions.length),
    [groups],
  );
  const [picked, setPicked] = useState<string | null>(null);
  useEffect(() => {
    let at: string | null = null;
    const clear = () => {
      at = null;
      setPicked(null);
    };
    const key = (event: KeyboardEvent) => {
      if (
        !event.ctrlKey ||
        !event.shiftKey ||
        event.altKey ||
        event.metaKey ||
        event.key === "Escape"
      )
        return clear();
      if (typing(event.target) && !terminal(event.target)) return clear();
      if (!empty.length) return clear();
      let index = empty.findIndex((card) => card.path === at);
      const fresh = index < 0;
      if (fresh) index = 0;
      const direction = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
      if (direction) {
        event.preventDefault();
        if (!fresh) index = (index + direction + empty.length) % empty.length;
      }
      const card = empty[index];
      at = card.path;
      setPicked(at);
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (event.repeat) return;
      open({
        repository: card.repository,
        cwd: card.path,
        branch: card.worktree?.branch ?? card.worktree?.shortHead ?? card.name,
      });
      clear();
    };
    const release = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey) clear();
    };
    const hidden = () => {
      if (document.hidden) clear();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("keyup", release, true);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("keyup", release, true);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [empty, open]);
  return empty.some((card) => card.path === picked) ? picked : null;
}
