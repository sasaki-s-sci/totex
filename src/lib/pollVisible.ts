/** Poll serially, pause while hidden, and refresh immediately on return. */
export function pollVisible<T>(
  read: () => Promise<T>,
  receive: (value: T) => void,
  every: number,
  page = document,
): () => void {
  let alive = true;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const round = async () => {
    clearTimeout(timer);
    if (!alive || page.hidden || pending) return;
    pending = true;
    try {
      const value = await read();
      if (alive && !page.hidden) receive(value);
    } catch {
      // Keep the last reading and retry after transient IPC failures.
    } finally {
      pending = false;
      if (alive && !page.hidden) timer = setTimeout(round, every);
    }
  };
  page.addEventListener("visibilitychange", round);
  void round();
  return () => {
    alive = false;
    clearTimeout(timer);
    page.removeEventListener("visibilitychange", round);
  };
}
