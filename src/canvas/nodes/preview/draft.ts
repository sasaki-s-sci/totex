import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { readFileHead } from "../../../folder/api";
import { folderOf } from "../../../folder/format";
import type { FilePreviewNodeData } from "../../../lib/graph";
import type { FilePageActions } from "../../../page/actions";
import { frontValue, readOnSnapshot } from "../../../shell/state";
import { watchDirectory } from "../../../sidebar/left/watch";
import { carried, merge } from "./merge";
import type { useReading } from "./reading";
import { countLines, draftOf, lineNumbers } from "./text";

type Draft = { text: string; disk: string | null; kept: string | null; dirty: boolean };

/** Where a card handed to another window, or the next front, picks its draft up. */
export function draftKey(requestId: number, path: string): string {
  return `draft.${requestId}.${path}`;
}

/** How long typing has to pause before what was typed is written. */
const AUTO_SAVE_MS = 600;

/** The caret's place in the paper, counted as `draftOf` counts; `null` when it is not in there. */
function caretIn(paper: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.focusNode) return null;
  if (!paper.contains(selection.focusNode)) return null;
  const range = document.createRange();
  range.setStart(paper, 0);
  range.setEnd(selection.focusNode, selection.focusOffset);
  return draftOf(range.cloneContents()).length;
}

/** Written whole, with the caret kept where it stood in what it was carried into. */
function rewrite(paper: HTMLElement, text: string): void {
  const before = draftOf(paper);
  const at = caretIn(paper);
  paper.textContent = text;
  if (at === null || !paper.firstChild) return;
  const selection = window.getSelection();
  selection?.collapse(paper.firstChild, Math.min(carried(at, before, text), text.length));
}

export function useDraft(
  data: FilePreviewNodeData,
  view: ReturnType<typeof useReading>,
  { saveFilePreview, refreshFilePreview }: FilePageActions,
) {
  const { paper, move, home, showCaret } = view;
  const key = draftKey(data.requestId, data.path);
  const restored = useRef(frontValue<Draft>(key));

  const editable = data.state === "ready" && data.text !== null && !data.truncated;

  const reading = useMemo(
    () => (data.text === null ? null : data.text.replace(/\r\n?/g, "\n")),
    [data.text],
  );
  // An editable box normalises line breaks; the endings the file came with go back on write.
  const crlf = data.text?.includes("\r\n") ?? false;
  // What the paper was last level with on disk, and that same text as the file holds it.
  const kept = useRef<string | null>(null);
  const disk = useRef<string | null>(null);
  const dirty = useRef(false);
  // The draft and the file changed the same place: only a save asked for writes over the file.
  const clashed = useRef(false);

  const [lines, setLines] = useState(1);
  const numbers = useMemo(() => lineNumbers(lines), [lines]);
  const [unsaved, setUnsaved] = useState(false);
  const [refused, setRefused] = useState(false);
  const writing = useRef<Promise<boolean> | null>(null);
  // The file's text while it is being written, so the card knows its own write when it comes back.
  const written = useRef<string | null>(null);
  const inputTimer = useRef<number | null>(null);
  const saveTimer = useRef<number | null>(null);
  const reread = useRef<(() => void) | null>(null);

  useLayoutEffect(
    () =>
      readOnSnapshot(key, async () => {
        if (writing.current) await writing.current;
        return {
          text: paper ? draftOf(paper) : (restored.current?.text ?? reading ?? ""),
          disk: disk.current,
          kept: kept.current,
          dirty: dirty.current,
        } satisfies Draft;
      }),
    [key, paper, reading],
  );

  const cancelSave = useCallback(() => {
    if (saveTimer.current === null) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
  }, []);

  const cancelInputInspection = useCallback(() => {
    if (inputTimer.current === null) return;
    clearTimeout(inputTimer.current);
    inputTimer.current = null;
  }, []);

  useEffect(
    () => () => {
      cancelInputInspection();
      cancelSave();
    },
    [cancelInputInspection, cancelSave],
  );

  /** `auto` is the card saving on its own: it leaves a draft that clashed with the file alone. */
  const save = useCallback(
    async (auto = false) => {
      cancelSave();
      if (writing.current && !(await writing.current)) return false;
      if (!paper || !editable) return true;
      if (auto && clashed.current) return false;
      cancelInputInspection();
      const draft = draftOf(paper);
      setLines(countLines(draft));
      move(0, 0);
      if (draft === kept.current) {
        dirty.current = false;
        setUnsaved(false);
        setRefused(false);
        return true;
      }
      const text = crlf ? draft.split("\n").join("\r\n") : draft;
      written.current = text;
      writing.current = saveFilePreview(data.requestId, text, disk.current ?? undefined);
      const went = await writing.current;
      writing.current = null;
      written.current = null;
      if (went) {
        kept.current = draft;
        disk.current = text;
        clashed.current = false;
      }
      dirty.current = !went || draftOf(paper) !== draft;
      setUnsaved(dirty.current);
      setRefused(!went);
      // Refused because the file moved since it was read: read it now rather than wait to be told.
      if (!went) reread.current?.();
      return went && !dirty.current;
    },
    [
      cancelInputInspection,
      cancelSave,
      crlf,
      data.requestId,
      editable,
      move,
      paper,
      saveFilePreview,
    ],
  );

  const saveSoon = useCallback(() => {
    cancelSave();
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void save(true);
    }, AUTO_SAVE_MS);
  }, [cancelSave, save]);

  // Written to the element only when it is not already holding it: React must not own an
  // editable box, and rendering would move the caret.
  useLayoutEffect(() => {
    if (!paper || reading === null) return;
    const before = restored.current;
    if (before?.dirty) {
      restored.current = undefined;
      paper.textContent = before.text;
      kept.current = before.kept;
      disk.current = before.disk;
      dirty.current = true;
      setLines(countLines(before.text));
      setUnsaved(true);
      setRefused(before.disk !== data.text);
      return;
    }
    if (data.text === disk.current) return;
    // The card's own write, come back as what the file now holds.
    if (data.text === written.current) {
      kept.current = reading;
      disk.current = data.text;
      return;
    }

    // First read, or the file written by something else: the paper follows it, and whatever was
    // typed and not yet written is carried over onto it.
    const first = disk.current === null;
    const draft = draftOf(paper);
    const carriedOver = dirty.current ? merge(kept.current ?? "", draft, reading) : reading;
    kept.current = reading;
    disk.current = data.text;
    if (carriedOver === null) {
      // Both changed the same place: the draft stays, unwritten, until it is saved over the file.
      clashed.current = true;
      setRefused(true);
      return;
    }
    if (carriedOver !== draft) {
      if (first) paper.textContent = carriedOver;
      else rewrite(paper, carriedOver);
    }
    dirty.current = carriedOver !== reading;
    clashed.current = false;
    setLines(countLines(carriedOver));
    setUnsaved(dirty.current);
    setRefused(false);
    if (first) home();
    else move(0, 0);
    if (dirty.current) saveSoon();
  }, [paper, reading, data.text, home, move, saveSoon]);

  // Follows the file: whatever writes it, the card reads it again and takes it up.
  const followed = data.state === "ready" && data.text !== null ? data.path : null;
  const known = useRef({ text: data.text, size: data.size });
  known.current = { text: data.text, size: data.size };
  const refresh = useRef(refreshFilePreview);
  refresh.current = refreshFilePreview;
  const requestId = data.requestId;
  useEffect(() => {
    if (!followed) return;
    const folder = folderOf(followed);
    if (!folder) return;
    let gone = false;
    let busy = false;
    let again = false;
    const look = () => {
      if (busy) {
        again = true;
        return;
      }
      busy = true;
      // Never in the middle of the card's own write, which would read half a file.
      void Promise.resolve(writing.current)
        .then(() => readFileHead(followed))
        .then((head) => {
          if (gone) return;
          if (head.text === known.current.text && head.size === known.current.size) return;
          refresh.current(requestId, {
            text: head.text,
            size: head.size,
            truncated: head.truncated,
          });
        })
        .catch(() => undefined)
        .finally(() => {
          busy = false;
          if (again && !gone) {
            again = false;
            look();
          }
        });
    };
    reread.current = look;
    const stop = watchDirectory(folder, look);
    return () => {
      gone = true;
      reread.current = null;
      stop();
    };
  }, [followed, requestId]);

  const typing = editable
    ? ({
        contentEditable: "plaintext-only",
        role: "textbox",
        "aria-multiline": true,
        "aria-label": data.name,
      } as const)
    : {};

  // Only the dirty mark is immediate; walking the DOM waits for a pause in typing, and writing
  // the file for a longer one.
  const onInput = useCallback(() => {
    if (!paper) return;
    dirty.current = true;
    setUnsaved(true);
    if (!clashed.current) setRefused(false);
    showCaret();
    cancelInputInspection();
    inputTimer.current = window.setTimeout(() => {
      inputTimer.current = null;
      const draft = draftOf(paper);
      setLines(countLines(draft));
      setUnsaved(draft !== kept.current);
      move(0, 0);
    }, 60);
    saveSoon();
  }, [cancelInputInspection, move, paper, saveSoon, showCaret]);

  return { editable, reading, lines, numbers, unsaved, refused, save, typing, onInput };
}
