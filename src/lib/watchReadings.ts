type Subscribe<T> = (receive: (value: T) => void) => Promise<() => void>;

/** Live session readings and the snapshot used when a window opens. */
type Readings<T> = {
  listen: Subscribe<T>;
  read: () => Promise<T[]>;
  exit: Subscribe<string>;
};

/**
 * Listens before asking for the snapshot, and ignores arrivals after cleanup.
 * Questions settle their snapshot immediately but delay live readings; reports
 * and activity use the same receiver for both.
 */
export function watchReadings<T>(
  source: Readings<T>,
  changed: (value: T) => void,
  ended: (id: string) => void,
  restored = changed,
): () => void {
  let alive = true;
  const listening = source.listen((value) => {
    if (alive) changed(value);
  });
  const finished = source.exit((id) => {
    if (alive) ended(id);
  });

  source
    .read()
    .then((standing) => {
      if (!alive) return;
      for (const value of standing) restored(value);
    })
    .catch(() => undefined);

  return () => {
    alive = false;
    void listening.then((off) => off()).catch(() => undefined);
    void finished.then((off) => off()).catch(() => undefined);
  };
}
