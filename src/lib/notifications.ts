/** Synchronous change notifications, in subscription order. */
export function notifications() {
  const listeners = new Set<() => void>();

  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    notify(): void {
      for (const listener of listeners) listener();
    },
  };
}
