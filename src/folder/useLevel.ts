/**
 * One open level's rows: read once, kept current by a watch on the directory,
 * and handed over a screenful at a time.
 */

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Listing, readDirectory } from "./api";
import { refreshChanges, useDirectoryChanges } from "./changes";
import { useRepositoryCounts } from "./counts";
import { FIRST_ROWS, MORE_ROWS } from "./rows";
import { watchDirectory } from "./watch";

export function useLevel(
  path: string,
  /** How far in the rows are drawn: one step per folder that was opened. */
  depth: number,
  onNavigate: (path: string) => void,
  onListing: ((listing: Listing) => void) | undefined,
) {
  const [listing, setListing] = useState<Listing | null>(null);
  /** A directory that would not open. Drawn as a rule where its rows would be
   *  and nothing else: what is missing is the listing, which is what shows. */
  const [failed, setFailed] = useState(false);
  /** The folders in this directory that have been opened, by path. */
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  /** How many of this directory's rows are drawn. See `FIRST_ROWS`. */
  const [shown, setShown] = useState(FIRST_ROWS);

  const rows = listing ? listing.entries.slice(0, shown) : [];
  const rest = listing ? listing.entries.length - rows.length : 0;

  // Which of the folders here are worth offering to the graph. Only the ones
  // that are drawn: the walk behind this answer is a walk per folder, and a
  // directory of three thousand of them would send three thousand of them out
  // for rows nobody has scrolled to. Asked again as more are drawn, and only
  // ever about the ones that have not been asked about — a file written in this
  // directory re-reads it, and a re-read must not send the walk out again for
  // an answer that cannot have moved.
  const folders = rows.filter((entry) => entry.isDir).map((entry) => entry.path);
  const counts = useRepositoryCounts(folders);

  // What git has to say about the rows here: what became of each of them, and
  // which of them it was told to ignore. Read for this directory alone and
  // shared with nobody: a level draws its own rows, and a folder further down
  // is answered for by the level showing it.
  const answer = useDirectoryChanges(path);
  // Both of those in the shape a row is looked up in, rebuilt only when git's
  // answer moves. A map rather than the object it arrives as, because a file
  // called `constructor` would otherwise find something that is not a colour.
  const changes = useMemo(() => new Map(Object.entries(answer.changed)), [answer]);
  const ignored = useMemo(() => new Set(answer.ignored), [answer]);

  /** Draws the next chunk of rows, out of whatever room the frame has. */
  const drawMore = useCallback(() => {
    startTransition(() => setShown((count) => count + MORE_ROWS));
  }, []);

  // Read rather than captured: a reading redirects the pane to the path that
  // answered, and re-reading the directory because a handler changed identity
  // is not what that is for.
  const report = useRef({ onNavigate, onListing });
  report.current = { onNavigate, onListing };

  useEffect(() => {
    let cancelled = false;

    // Only the first reading empties the level. A re-read after something moved
    // replaces the rows in place: the directory is on screen and being looked
    // at, and blanking it would be a flicker for one changed row.
    const read = (announce: boolean) => {
      if (announce) {
        setListing(null);
        setFailed(false);
        setShown(FIRST_ROWS);
      }
      // Everything the directory holds, hidden entries included: there is no
      // toggle to turn them back on, so they are shown like the rest. The
      // leading dot is what says a file is hidden, and it is already in the
      // name — a row drawn fainter than its neighbours says the second, weaker
      // thing instead: that it is somehow less of a file, which is what the
      // ignore list says about a name and being hidden does not.
      readDirectory(path, true)
        .then((next) => {
          if (cancelled) return;
          setListing(next);
          setFailed(false);
          report.current.onListing?.(next);
          // `~`, `..` and the legacy WSL share are all folded by the backend, so
          // the pane moves to the path that actually answered — which is the one
          // worth watching, and the one the graph would be handed. Only the
          // pane's own folder: every level under it was named by a listing that
          // had already been folded.
          if (depth === 0 && next.path !== path) report.current.onNavigate(next.path);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };

    read(true);
    // Watched for as long as this level is on screen, so a worktree removed —
    // or a file written by whatever is running in the panel — leaves the pane
    // as soon as it leaves the disk. What is uncommitted moved with it, and is
    // read again on the back of the same event rather than waiting for its own
    // clock: a file saved in the panel is a row that turns orange as it is
    // saved.
    const stop = watchDirectory(path, () => {
      read(false);
      refreshChanges();
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [path, depth]);

  return {
    failed,
    expanded,
    setExpanded,
    rows,
    rest,
    shown,
    counts,
    changes,
    allIgnored: answer.allIgnored,
    ignored,
    drawMore,
  };
}
