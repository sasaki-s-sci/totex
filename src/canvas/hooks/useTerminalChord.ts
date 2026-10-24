import { useEffect, useState } from "react";
import { terminal } from "../../lib/keys";

/** Ctrl with Shift or Alt held while a terminal has focus: the canvas shows its worktrees over the files. */
export function useTerminalChord(): boolean {
  const [chord, setChord] = useState(false);
  useEffect(() => {
    const sync = (event: KeyboardEvent) =>
      setChord(
        event.ctrlKey && (event.shiftKey || event.altKey) && terminal(document.activeElement),
      );
    const clear = () => setChord(false);
    window.addEventListener("keydown", sync, true);
    window.addEventListener("keyup", sync, true);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync, true);
      window.removeEventListener("keyup", sync, true);
      window.removeEventListener("blur", clear);
    };
  }, []);
  return chord;
}
