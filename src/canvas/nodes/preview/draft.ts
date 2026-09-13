import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FilePreviewNodeData } from "../../../lib/graph";
import { frontValue, readOnSnapshot } from "../../../shell/state";
import type { useReading } from "./reading";
import { countLines, draftOf, lineNumbers } from "./text";

type Draft = { text: string; disk: string | null; kept: string | null; dirty: boolean };

/** Where a card handed to another window, or the next front, picks its draft up. */
export function draftKey(requestId: number, path: string): string {
  return `draft.${requestId}.${path}`;
}

export function useDraft(
  data: FilePreviewNodeData,
  view: ReturnType<typeof useReading>,
  saveFilePreview: (requestId: number, text: string, expected?: string) => Promise<boolean>,
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
  const kept = useRef(reading);
  const disk = useRef(data.text);
  const dirty = useRef(false);

  const [lines, setLines] = useState(1);
  const numbers = useMemo(() => lineNumbers(lines), [lines]);
  const [unsaved, setUnsaved] = useState(false);
  const [refused, setRefused] = useState(false);
  const writing = useRef<Promise<boolean> | null>(null);
  const inputTimer = useRef<number | null>(null);

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
    if (dirty.current && draftOf(paper) !== reading) {
      setRefused(true);
      return;
    }
    kept.current = reading;
    disk.current = data.text;
    if (draftOf(paper) === reading) return;
    paper.textContent = reading;
    setLines(countLines(reading));
    setUnsaved(false);
    setRefused(false);
    home();
  }, [paper, reading, data.text, home]);

  const cancelInputInspection = useCallback(() => {
    if (inputTimer.current === null) return;
    clearTimeout(inputTimer.current);
    inputTimer.current = null;
  }, []);

  useEffect(() => cancelInputInspection, [cancelInputInspection]);

  const save = useCallback(async () => {
    if (writing.current && !(await writing.current)) return false;
    if (!paper || !editable) return true;
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
    writing.current = saveFilePreview(
      data.requestId,
      crlf ? draft.split("\n").join("\r\n") : draft,
      disk.current ?? undefined,
    );
    const went = await writing.current;
    writing.current = null;
    dirty.current = !went || draftOf(paper) !== draft;
    if (went) {
      kept.current = draft;
      disk.current = crlf ? draft.split("\n").join("\r\n") : draft;
    }
    setUnsaved(dirty.current);
    setRefused(!went);
    return went && !dirty.current;
  }, [cancelInputInspection, crlf, data.requestId, editable, move, paper, saveFilePreview]);

  const typing = editable
    ? ({
        contentEditable: "plaintext-only",
        role: "textbox",
        "aria-multiline": true,
        "aria-label": data.name,
      } as const)
    : {};

  // Only the dirty mark is immediate; walking the DOM waits for a pause in typing.
  const onInput = useCallback(() => {
    if (!paper) return;
    dirty.current = true;
    setUnsaved(true);
    setRefused(false);
    showCaret();
    cancelInputInspection();
    inputTimer.current = window.setTimeout(() => {
      inputTimer.current = null;
      const draft = draftOf(paper);
      setLines(countLines(draft));
      setUnsaved(draft !== kept.current);
      move(0, 0);
    }, 60);
  }, [cancelInputInspection, move, paper, showCaret]);

  return { editable, reading, lines, numbers, unsaved, refused, save, typing, onInput };
}
