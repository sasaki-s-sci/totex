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
 * A destructive item is armed by its first press and run by its second, so the
 * arm is reset alongside the rest.
 *
 * Both of the graph's menus work this way, which is the reason this is not
 * written in either of them.
 */
export function useMenuAction(onClose: () => void) {
  /** Which item is running, by the label it was started under, or null. */
  const [busy, setBusy] = useState<string | null>(null);
  /** Which item was refused, by the same label. */
  const [failed, setFailed] = useState<string | null>(null);
  /** Whether a destructive item has been armed by a first press. */
  const [confirming, setConfirming] = useState(false);

  const run = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      setBusy(label);
      setFailed(null);
      try {
        await action();
        onClose();
      } catch {
        setFailed(label);
        setBusy(null);
        setConfirming(false);
      }
    },
    [onClose],
  );

  /** Puts the menu back as it opened, for a target that has just changed. */
  const reset = useCallback(() => {
    setBusy(null);
    setFailed(null);
    setConfirming(false);
  }, []);

  return { busy, failed, confirming, setConfirming, run, reset };
}
