import { useCallback, useState } from "react";

/** Closes the menu on success and keeps it open on refusal. The result is returned
 *  after the close, so what callers do with it lands after the popover restores focus. */
export function useMenuAction(onClose: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
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

  const reset = useCallback(() => {
    setBusy(null);
    setFailed(null);
  }, []);

  return { busy, failed, run, reset };
}
