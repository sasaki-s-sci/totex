/**
 * What a card holds while it is being typed into, and writing it back.
 *
 * The card holds the typing — a keystroke is not something the graph is rebuilt
 * for — and hands it over when it is to be kept.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FilePreviewNodeData } from "../../../lib/graph";
import type { useReading } from "./reading";
import { countLines, draftOf, lineNumbers } from "./text";

export function useDraft(
  data: FilePreviewNodeData,
  view: ReturnType<typeof useReading>,
  saveFilePreview: (requestId: number, text: string, expected?: string) => Promise<boolean>,
) {
  const { paper, move, home, showCaret } = view;

  const editable = data.state === "ready" && data.text !== null && !data.truncated;

  /**
   * The reading as the card holds it, with every line ending the same way.
   *
   * An editable box keeps line breaks as newlines whatever the file had, so a
   * file written on Windows would come back with every one of its endings
   * changed by the first save. The endings it arrived with are noted here and
   * put back when it is written.
   */
  const reading = useMemo(
    () => (data.text === null ? null : data.text.replace(/\r\n?/g, "\n")),
    [data.text],
  );
  const crlf = data.text?.includes("\r\n") ?? false;
  // Read by the handlers, which are not rebuilt for a save.
  const kept = useRef(reading);
  const disk = useRef(data.text);
  const dirty = useRef(false);

  const [lines, setLines] = useState(1);
  const numbers = useMemo(() => lineNumbers(lines), [lines]);
  /** There is more in the card than the file holds. */
  const [unsaved, setUnsaved] = useState(false);
  /** The last write did not go through, and what is in the card is all there is. */
  const [refused, setRefused] = useState(false);
  const writing = useRef<Promise<boolean> | null>(null);
  const inputTimer = useRef<number | null>(null);

  /**
   * The reading, written to the element rather than drawn from the data.
   *
   * React does not own what is inside an editable box: rendering the text would
   * replace it on every save and take the caret along with it. So it is written
   * here, and only when the element is not already holding it — which is when a
   * file has just been read, and never when what came back is what was just
   * written to disk.
   */
  useLayoutEffect(() => {
    if (!paper || reading === null) return;
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

  /** Cancels the deferred inspection when a save or unmount supersedes it. */
  const cancelInputInspection = useCallback(() => {
    if (inputTimer.current === null) return;
    clearTimeout(inputTimer.current);
    inputTimer.current = null;
  }, []);

  useEffect(() => cancelInputInspection, [cancelInputInspection]);

  /** Keep what the file holds, and say nothing when it already holds it. */
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
    // Typing carries on while a write is in flight, and what went to disk is
    // then already behind what is on screen.
    dirty.current = !went || draftOf(paper) !== draft;
    if (went) {
      kept.current = draft;
      disk.current = crlf ? draft.split("\n").join("\r\n") : draft;
    }
    setUnsaved(dirty.current);
    setRefused(!went);
    return went && !dirty.current;
  }, [cancelInputInspection, crlf, data.requestId, editable, move, paper, saveFilePreview]);

  /**
   * What a reading that can be typed into is, and nothing at all for one that
   * cannot: a box that answers to nobody says so by holding none of this.
   */
  const typing = editable
    ? ({
        contentEditable: "plaintext-only",
        role: "textbox",
        "aria-multiline": true,
        "aria-label": data.name,
      } as const)
    : {};

  const onInput = useCallback(() => {
    if (!paper) return;
    // The edit itself is enough to mark the card immediately. Walking its DOM,
    // rebuilding the gutter and measuring the reading can wait until typing
    // pauses; repeated input replaces this one pending job instead of stacking
    // work on the input event.
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
      // A line added or taken away changes what the reading comes to, which is
      // what says how far it can be moved and how long the rails are.
      move(0, 0);
    }, 60);
  }, [cancelInputInspection, move, paper, showCaret]);

  return { editable, reading, lines, numbers, unsaved, refused, save, typing, onInput };
}
