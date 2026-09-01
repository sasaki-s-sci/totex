import { useCallback, useState } from "react";

/**
 * Running one git operation from a menu, and what the menu shows while it does.
 *
 * The menu closes when the operation goes through, and stays open when it does
 * not: a refusal is the answer to what was clicked, and the mark that was
 * clicked is what carries it — it goes red and stays red until the next press.
 * Nothing is written. What the window can tell beforehand would be refused is
 * not offered at all, so what reaches here is only what git itself turned down.
 *
 * What a destructive press costs is asked about in words before it is run —
 * see the box in `WorktreeMenu` — and that question is not this hook's to hold:
 * it outlives the menu it was asked from, and this is reset when the menu is.
 *
 * What the operation answered comes back to whoever asked for it, and a refusal
 * answers with nothing, there being nothing to carry on with. It comes back
 * after the menu has closed: whatever is done with it is done to a window the
 * menu has already left. That is what the terminal a new branch comes up
 * with depends on — a closing popover hands the keyboard back to wherever it
 * took it from, and a terminal opened before that would have it taken away
 * again.
 *
 * Both of the graph's menus work this way, which is the reason this is not
 * written in either of them.
 */
export function useMenuAction(onClose: () => void) {
  /** Which item is running, by the label it was started under, or null. */
  const [busy, setBusy] = useState<string | null>(null);
  /** Which item was refused, by the same label. */
  const [failed, setFailed] = useState<string | null>(null);

  const run = useCallback(
    async <T>(label: string, action: () => Promise<T>): Promise<T | null> => {
      setBusy(label);
      setFailed(null);
      try {
        const done = await action();
        onClose();
        return done;
      } catch {
        setFailed(label);
        setBusy(null);
        return null;
      }
    },
    [onClose],
  );

  /** Puts the menu back as it opened, for a target that has just changed. */
  const reset = useCallback(() => {
    setBusy(null);
    setFailed(null);
  }, []);

  return { busy, failed, run, reset };
}
