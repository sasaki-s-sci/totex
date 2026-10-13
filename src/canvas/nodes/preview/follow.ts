import { useCallback, useEffect, useRef, useState } from "react";
import { type FileStamp, readFileHead, statFile } from "../../../folder/api";
import { folderOf } from "../../../folder/format";
import type { FilePreviewNodeData } from "../../../lib/graph";
import type { FileReading } from "../../../page/actions";
import { watchDirectory } from "../../../sidebar/left/watch";
import { readFilePreview } from "../../hooks/useFilePreviewPlacing";

function same(one: FileStamp | null, other: FileStamp): boolean {
  return one !== null && one.size === other.size && one.modifiedMs === other.modifiedMs;
}

/**
 * Keeps a page level with its file, whatever the page draws: each change in the folder is
 * answered by a stat, and the file is read again only when its size or time moved. `settled`
 * holds the look back while the page's own write is in flight, which would read half a file.
 */
export function useFollow(
  data: FilePreviewNodeData,
  refresh: (id: number, read: FileReading) => void,
  settled: () => Promise<unknown>,
) {
  const [gone, setGone] = useState(false);
  const followed = data.state === "ready" ? data.path : null;
  // A page holding the bytes draws them; one holding only text reads the head as it was opened.
  const whole = data.picture !== null;
  const known = useRef(data);
  known.current = data;
  const tell = useRef(refresh);
  tell.current = refresh;
  const wait = useRef(settled);
  wait.current = settled;
  const look = useRef<() => void>(() => {});

  useEffect(() => {
    if (!followed) return;
    const folder = folderOf(followed);
    let stopped = false;
    let busy = false;
    let again = false;
    // The first stat only marks where the file stood when the page was read.
    let stamp: FileStamp | null = null;
    let marked = false;
    const step = async () => {
      await wait.current();
      let now: FileStamp;
      try {
        now = await statFile(followed);
      } catch (error) {
        if (!stopped && String(error).includes("no-such-file")) setGone(true);
        return;
      }
      if (stopped) return;
      setGone(false);
      if (!marked) {
        marked = true;
        stamp = now;
        return;
      }
      if (same(stamp, now)) return;
      stamp = now;
      const page = known.current;
      const read: FileReading = whole
        ? await readFilePreview(followed, page.view).then((fresh) => ({
            text: fresh.text ?? null,
            size: fresh.size ?? now.size,
            truncated: fresh.truncated ?? false,
            picture: fresh.picture ?? null,
          }))
        : await readFileHead(followed).then((head) => ({
            text: head.text,
            size: head.size,
            truncated: head.truncated,
          }));
      if (stopped) return;
      const held = known.current;
      if (
        read.text === held.text &&
        read.size === held.size &&
        (read.picture === undefined || read.picture === held.picture)
      )
        return;
      tell.current(held.requestId, read);
    };
    const run = () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      void step()
        .catch(() => undefined)
        .finally(() => {
          busy = false;
          if (again && !stopped) {
            again = false;
            run();
          }
        });
    };
    look.current = run;
    run();
    const stop = folder ? watchDirectory(folder, run) : () => {};
    // A change the watcher missed (a network share, a folder replaced whole) shows on return.
    window.addEventListener("focus", run);
    return () => {
      stopped = true;
      look.current = () => {};
      stop();
      window.removeEventListener("focus", run);
    };
  }, [followed, whole]);

  return { gone, look: useCallback(() => look.current(), []) };
}
