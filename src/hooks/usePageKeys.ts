// Files and terminals share numbering and navigation; editors keep their text shortcuts.

import { useEffect, useRef } from "react";

import { terminal, typing } from "../lib/keys";

type Options = {
  entries: readonly { id: string }[];
  active: string | null;
  show: (id: string) => void;
  close: (id: string) => Promise<void>;
  create: () => void;
};

const STEPS: Record<string, number> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };

export function usePageKeys({ entries, active, show, close, create }: Options) {
  const latest = useRef({ entries, active, show, close, create });
  latest.current = { entries, active, show, close, create };

  useEffect(() => {
    let typed: { number: number; at: number } | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      // Navigation belongs to the pages, independently of where their pages are shown.
      if (event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (!event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) return;
        const sidebarArrow =
          !event.altKey &&
          (event.key === "ArrowUp" || event.key === "ArrowDown") &&
          event.target instanceof Element &&
          event.target.closest(".page--sidebar");
        const fileNumber =
          !event.altKey &&
          /^[0-9]$/.test(event.key) &&
          event.target instanceof Element &&
          event.target.closest(".file-preview");
        if (typing(event.target) && !terminal(event.target) && !sidebarArrow && !fileNumber) return;
        const { entries, active, show } = latest.current;
        if (!event.altKey && /^[0-9]$/.test(event.key)) {
          const digit = Number(event.key);
          const combined = typed && Date.now() - typed.at < 700 ? typed.number * 10 + digit : digit;
          const number = combined > entries.length ? digit : combined;
          // Ctrl+0 alone remains zoom reset; after another digit it selects 10, 20, etc.
          if (!number) return;
          event.preventDefault();
          if (event.repeat) return;
          const next = entries[number - 1];
          typed = next ? { number, at: Date.now() } : null;
          if (next) show(next.id);
          return;
        }
        if (event.key.toLowerCase() === "x") {
          if (typing(event.target) && !terminal(event.target)) return;
          if (!active) return;
          event.preventDefault();
          if (event.repeat) return;
          void latest.current.close(active);
          return;
        }
        const step = STEPS[event.key];
        if (!step) {
          if (event.altKey) return;
        } else {
          event.preventDefault();
          if (event.repeat) return;
          typed = null;
          const at = entries.findIndex((entry) => entry.id === active);
          if (entries.length === 0) return;
          const next =
            at < 0
              ? step > 0
                ? 0
                : entries.length - 1
              : (at + step + entries.length) % entries.length;
          show(entries[next].id);
          return;
        }
      }

      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "a" && event.key !== "A") return;
      // Select-all belongs to what is being written in, except a terminal, which gives the key up
      // in `CliView`.
      if (typing(event.target) && !terminal(event.target)) return;

      event.preventDefault();
      if (!event.repeat) latest.current.create();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control") typed = null;
    };
    const onNumberKeyDown = (event: KeyboardEvent) => {
      if (/^[0-9]$/.test(event.key)) onKeyDown(event);
      else if (event.key !== "Control") typed = null;
    };
    window.addEventListener("keydown", onNumberKeyDown, true);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp, true);
    return () => {
      window.removeEventListener("keydown", onNumberKeyDown, true);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp, true);
    };
  }, []);
}
