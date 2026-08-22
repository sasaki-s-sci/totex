import CloseIcon from "@mui/icons-material/Close";
import HeightIcon from "@mui/icons-material/Height";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import {
  type NodeProps,
  NodeResizeControl,
  NodeResizer,
  ResizeControlVariant,
} from "@xyflow/react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useReadingSize } from "../../hooks/useReadingSize";
import type { FilePreviewFlowNode, FilePreviewNodeData } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

/** The smallest box a reading is still worth drawing in. */
export const MIN_WIDTH = 180;
export const MIN_HEIGHT = 96;

/** The card's own edge, which stands outside everything measured inside it. */
const BORDERS = 2;

/** What one line of a wheel comes to, for the mice that count in lines. */
const LINE = 16;

/** How much of a file is read at all. `MAX_FILE_HEAD` in src-tauri/src/fs_browse.rs. */
const HEAD_KB = 64;

/** How much of the box is kept past the caret when it is brought back in. */
const CARET_ROOM = 16;

/**
 * Moving the reading inside its card, rather than scrolling it.
 *
 * A box with more in it than fits, that can be scrolled to reach the rest, is a
 * scroller — and a scroller on the canvas is a compositing layer of its own,
 * which is enough to have the whole graph drawn once at one scale and stretched
 * to whatever it is zoomed to. `graph.css` states the rule at its head. So the
 * body is clipped, the reading is moved by a transform, and how far it has been
 * moved is drawn as a pair of rails.
 *
 * Written to the elements rather than held as state: a wheel arrives many times
 * a second, a keystroke nearly as often, and none of it is anything the graph
 * has to be laid out again for.
 */
function useReading() {
  // The two elements that anything here has to be told about are held as state
  // rather than as refs: a card put away and taken back out draws a new box and
  // a new reading, and an effect that watches a ref is never told. What was
  // watched then was an element that is no longer in the window.
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [paper, setPaper] = useState<HTMLPreElement | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const gutter = useRef<HTMLPreElement>(null);
  const across = useRef<HTMLElement>(null);
  const down = useRef<HTMLElement>(null);
  const at = useRef({ x: 0, y: 0 });
  const wheel = useRef({ x: 0, y: 0 });
  const wheelFrame = useRef<number | null>(null);
  const caretFrame = useRef<number | null>(null);

  /** Move by this much, and redraw where that leaves everything. */
  const move = useCallback(
    (dx: number, dy: number) => {
      const box = body;
      const reading = sheet.current;
      if (!box || !reading) return;
      const room = {
        x: Math.max(0, reading.offsetWidth - box.clientWidth),
        y: Math.max(0, reading.offsetHeight - box.clientHeight),
      };
      const now = {
        x: Math.min(room.x, Math.max(0, at.current.x + dx)),
        y: Math.min(room.y, Math.max(0, at.current.y + dy)),
      };
      at.current = now;
      reading.style.transform = `translate(${-now.x}px, ${-now.y}px)`;
      if (gutter.current) gutter.current.style.transform = `translateX(${now.x}px)`;
      rail(across.current, "width", "left", box.clientWidth, reading.offsetWidth, now.x, room.x);
      rail(down.current, "height", "top", box.clientHeight, reading.offsetHeight, now.y, room.y);
    },
    [body],
  );

  /** Back to the top of a reading that has just been opened. */
  const home = useCallback(() => {
    wheel.current = { x: 0, y: 0 };
    at.current = { x: 0, y: 0 };
    move(0, 0);
  }, [move]);

  // A trackpad can send several wheel events inside one display frame. Their
  // distance is additive, but measuring and writing the reading for each event
  // only forces the same layout several times before any of it can be painted.
  // Keep all of the distance and apply it once at the next frame boundary.
  const queueMove = useCallback(
    (dx: number, dy: number) => {
      wheel.current.x += dx;
      wheel.current.y += dy;
      if (wheelFrame.current !== null) return;
      wheelFrame.current = requestAnimationFrame(() => {
        wheelFrame.current = null;
        const next = wheel.current;
        wheel.current = { x: 0, y: 0 };
        move(next.x, next.y);
      });
    },
    [move],
  );

  // The box changes size when the card is dragged by an edge or put away, and
  // the reading changes when the file is read or typed into: either can leave
  // it standing past its own end, so both settle it back with a move of
  // nothing.
  useEffect(() => {
    if (!body) return;
    const watch = new ResizeObserver(() => move(0, 0));
    watch.observe(body);
    return () => watch.disconnect();
  }, [body, move]);

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      // Most wheels count in pixels; some count in lines, and a page is the box.
      const step =
        event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? (body?.clientHeight ?? 0) : 1;
      queueMove(event.deltaX * step, event.deltaY * step);
    },
    [body, queueMove],
  );

  /**
   * Brings the caret back into the box when typing has taken it outside.
   *
   * Nothing else would: the box is clipped rather than scrolled, so there is no
   * scroller for the engine to bring the caret into view in, and the line being
   * typed would simply carry on past the edge. The caret is measured on screen,
   * where the canvas's zoom is already in it, so the move is taken back through
   * the scale the box is drawn at.
   */
  const showCaretNow = useCallback(() => {
    const box = body;
    const selection = document.getSelection();
    if (!box || !selection || selection.rangeCount === 0) return;
    const caret = selection.getRangeAt(0).getBoundingClientRect();
    if (caret.height === 0 && caret.width === 0) return;
    const frame = box.getBoundingClientRect();
    const scale = box.clientWidth > 0 ? frame.width / box.clientWidth : 1;
    const room = CARET_ROOM * scale;
    const dx =
      caret.left < frame.left + room
        ? caret.left - frame.left - room
        : caret.right > frame.right - room
          ? caret.right - frame.right + room
          : 0;
    const dy =
      caret.top < frame.top
        ? caret.top - frame.top
        : caret.bottom > frame.bottom
          ? caret.bottom - frame.bottom
          : 0;
    if (dx === 0 && dy === 0) return;
    move(dx / scale, dy / scale);
  }, [body, move]);

  // Selection geometry is only settled after the edit event. Waiting for the
  // next frame both gives the browser that chance and coalesces input and keyup
  // into one measurement.
  const showCaret = useCallback(() => {
    if (caretFrame.current !== null) return;
    caretFrame.current = requestAnimationFrame(() => {
      caretFrame.current = null;
      showCaretNow();
    });
  }, [showCaretNow]);

  useEffect(
    () => () => {
      if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current);
      if (caretFrame.current !== null) cancelAnimationFrame(caretFrame.current);
    },
    [],
  );

  return { setBody, sheet, gutter, paper, setPaper, across, down, move, home, onWheel, showCaret };
}

/**
 * One rail: as long a share of the edge as is being shown, as far along it as
 * the reading has been moved. Nothing to move means nothing to say.
 */
function rail(
  element: HTMLElement | null,
  length: "width" | "height",
  from: "left" | "top",
  box: number,
  whole: number,
  at: number,
  room: number,
) {
  if (!element) return;
  if (room <= 0) {
    element.style[length] = "0px";
    return;
  }
  const size = Math.max(12, (box / whole) * box);
  element.style[length] = `${size}px`;
  element.style[from] = `${(at / room) * (box - size)}px`;
}

/**
 * How wide an element would stand if the rule holding it to the card were
 * lifted.
 *
 * Both of the things a card is as wide as are held to the card rather than to
 * themselves: the reading by a `min-width` that keeps it filling the box under
 * it, the header by being one row of a column. Neither will say what it would
 * take on its own while that holds, so the rule is taken off, the width is
 * read, and it is put straight back — one forced layout inside one press, and
 * the frame is painted from what was already there.
 */
function widthWithout(element: HTMLElement | null, rule: "minWidth" | "width", lifted: string) {
  if (!element) return 0;
  const held = element.style[rule];
  element.style[rule] = lifted;
  const width = element.offsetWidth;
  element.style[rule] = held;
  return width;
}

/**
 * A card standing on the canvas: the grips that resize it, and the card itself.
 *
 * A pinned card is not one of these. It has left the canvas — the node is
 * hidden and `GitGraph` draws the card over the graph instead — so the grips,
 * which are React Flow's and are drawn in the canvas's own coordinates, are
 * here rather than on the card, where they would follow it off.
 */
export function FilePreviewNode({ data }: NodeProps<FilePreviewFlowNode>) {
  return (
    <>
      {data.collapsed ? (
        // Put away, the card is as tall as its header and nothing else, so the
        // only thing left to drag is how wide it is.
        <>
          <NodeResizeControl
            className="file-preview__edge"
            variant={ResizeControlVariant.Line}
            position="left"
            resizeDirection="horizontal"
            minWidth={MIN_WIDTH}
          />
          <NodeResizeControl
            className="file-preview__edge"
            variant={ResizeControlVariant.Line}
            position="right"
            resizeDirection="horizontal"
            minWidth={MIN_WIDTH}
          />
        </>
      ) : (
        <NodeResizer
          minWidth={MIN_WIDTH}
          minHeight={MIN_HEIGHT}
          lineClassName="file-preview__edge"
          handleClassName="file-preview__corner"
        />
      )}
      <FilePreviewCard data={data} />
    </>
  );
}

/**
 * The card itself: a file's reading, and what can be done to it.
 *
 * Drawn in two places and the same in both — as the body of a node while it
 * stands on the canvas, and on the layer over the canvas once it is pinned.
 * Everything it does it does through `data` and the graph's actions, so which
 * of the two it is standing in is not something it has to know.
 */
export function FilePreviewCard({ data }: { data: FilePreviewNodeData }) {
  const { t } = useTranslation();
  const { closeFilePreview, saveFilePreview, collapseFilePreview, fitFilePreview, pinFilePreview } =
    useGraphActions();
  const detail = data.size === null ? null : formatSize(data.size);
  const { setBody, sheet, gutter, paper, setPaper, across, down, move, home, onWheel, showCaret } =
    useReading();
  /** The header, measured alongside the reading when the card is asked to fit:
   *  the name in it is as much what the card is showing as the lines are. */
  const bar = useRef<HTMLElement>(null);
  // How large the reading is drawn, for every card at once. Ctrl and a plus or
  // a minus is what changes it; `useReadingKeys` in the graph listens for them.
  const size = useReadingSize();

  // A reading drawn larger or smaller comes to a different size on the page, so
  // how far it can be moved changes with it. Its box did not, and the box is
  // what the observer inside `useReading` watches, so it is settled here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the new size is the trigger, and it is written to the card rather than read here
  useLayoutEffect(() => {
    move(0, 0);
  }, [size, move]);

  // A file the card holds only the head of is read and never written: what is
  // on screen is what would go to disk, and the rest of the file would go with
  // it. The backend refuses the same write; this is what keeps the card from
  // offering it.
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
  kept.current = reading;

  const [lines, setLines] = useState(1);
  const numbers = useMemo(() => lineNumbers(lines), [lines]);
  /** There is more in the card than the file holds. */
  const [unsaved, setUnsaved] = useState(false);
  /** The last write did not go through, and what is in the card is all there is. */
  const [refused, setRefused] = useState(false);
  const writing = useRef(false);
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
    if (draftOf(paper) === reading) return;
    paper.textContent = reading;
    setLines(countLines(reading));
    setUnsaved(false);
    setRefused(false);
    home();
  }, [paper, reading, home]);

  /** Cancels the deferred inspection when a save or unmount supersedes it. */
  const cancelInputInspection = useCallback(() => {
    if (inputTimer.current === null) return;
    clearTimeout(inputTimer.current);
    inputTimer.current = null;
  }, []);

  useEffect(() => cancelInputInspection, [cancelInputInspection]);

  /** Keep what the file holds, and say nothing when it already holds it. */
  const save = useCallback(async () => {
    if (!paper || !editable || writing.current) return;
    cancelInputInspection();
    const draft = draftOf(paper);
    setLines(countLines(draft));
    move(0, 0);
    if (draft === kept.current) {
      setUnsaved(false);
      return;
    }
    writing.current = true;
    const went = await saveFilePreview(
      data.requestId,
      crlf ? draft.split("\n").join("\r\n") : draft,
    );
    writing.current = false;
    // Typing carries on while a write is in flight, and what went to disk is
    // then already behind what is on screen.
    setUnsaved(!went || draftOf(paper) !== draft);
    setRefused(!went);
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

  /**
   * Puts the card at the width of what is in it.
   *
   * Both parts are measured, because a card too narrow cuts both: the longest
   * line of the reading, and the header, whose name goes to an ellipsis long
   * before the lines under it run out. The wider of the two is what is asked
   * for. A card that is put away, or holding a file that would not read, has
   * only the header — which is then the whole of what it is showing, and so the
   * whole of what it should be as wide as.
   *
   * The width and nothing else: a card is dragged taller to see more of a file,
   * and there is no height that fits one — the reading goes on for as long as
   * the file does.
   */
  function fitWidth() {
    const header = widthWithout(bar.current, "width", "max-content");
    const reading = widthWithout(sheet.current, "minWidth", "0");
    fitFilePreview(data.requestId, Math.max(MIN_WIDTH, Math.max(header, reading) + BORDERS));
  }

  return (
    <article
      className={`file-preview${data.collapsed ? " is-collapsed" : ""}${
        data.pinnedAt ? " is-pinned" : ""
      }`}
      // Said once on the card, so that the gutter and the text are always the
      // same size as one another, and so that the size is the only thing the
      // stylesheet gives up.
      style={{ "--reading-size": `${size}px` } as CSSProperties}
      onKeyDown={(event) => {
        // What every other window keeps a file with. There is nothing else to
        // press inside a card: one put away or clicked out of keeps itself,
        // and how large the reading is drawn is Ctrl and a plus or a minus,
        // which the window listens for on every card's behalf.
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void save();
        }
      }}
    >
      <header className="file-preview__header" title={data.path} ref={bar}>
        <span className="file-preview__name">{data.name}</span>
        {unsaved && (
          <i
            className={`file-preview__unsaved${refused ? " is-refused" : ""}`}
            role="img"
            aria-label={t(refused ? "filePreview.unwritable" : "filePreview.unsaved", {
              name: data.name,
            })}
          />
        )}
        {detail && <span className="file-preview__size">{detail}</span>}
        {/* Pinned, the card leaves the canvas and is drawn over it: the graph
            is dragged, zoomed and laid out again underneath, and the reading
            stays where it was put. A pin driven in is a pin that is holding
            something, which is why the mark fills in rather than changes. */}
        <button
          type="button"
          className="file-preview__button nodrag"
          aria-label={t(data.pinnedAt ? "filePreview.unpin" : "filePreview.pin", {
            name: data.name,
          })}
          onClick={(event) => {
            event.stopPropagation();
            pinFilePreview(data.requestId);
          }}
        >
          {data.pinnedAt ? (
            <PushPinIcon sx={{ fontSize: 14 }} />
          ) : (
            <PushPinOutlinedIcon sx={{ fontSize: 14 }} />
          )}
        </button>
        {/* Sideways: the arrow points the two ways the card is being asked to
            move, which is the whole of what this does. The reading is not
            reflowed and the file is not touched — only the edges go out to
            the longest line, or in to it. */}
        <button
          type="button"
          className="file-preview__button nodrag"
          aria-label={t("filePreview.fitWidth", { name: data.name })}
          onClick={(event) => {
            event.stopPropagation();
            fitWidth();
          }}
        >
          <HeightIcon sx={{ fontSize: 14, transform: "rotate(90deg)" }} />
        </button>
        <button
          type="button"
          className="file-preview__button nodrag"
          aria-label={t(data.collapsed ? "filePreview.expand" : "filePreview.collapse", {
            name: data.name,
          })}
          onClick={(event) => {
            event.stopPropagation();
            collapseFilePreview(data.requestId);
          }}
        >
          {data.collapsed ? (
            <KeyboardArrowDownIcon sx={{ fontSize: 14 }} />
          ) : (
            <KeyboardArrowUpIcon sx={{ fontSize: 14 }} />
          )}
        </button>
        <button
          type="button"
          className="file-preview__button nodrag"
          aria-label={t("filePreview.close", { name: data.name })}
          onClick={(event) => {
            event.stopPropagation();
            closeFilePreview(data.requestId);
          }}
        >
          <CloseIcon sx={{ fontSize: 14 }} />
        </button>
      </header>

      {!data.collapsed && (
        <div className="file-preview__body nodrag nowheel" ref={setBody} onWheel={onWheel}>
          {data.state === "loading" && (
            <p className="file-preview__message">{t("filePreview.loading")}</p>
          )}
          {data.state === "failed" && (
            <p className="file-preview__message is-error">{t("filePreview.failed")}</p>
          )}
          {data.state === "ready" && data.text === null && (
            <p className="file-preview__message">{t("filePreview.notText")}</p>
          )}
          {data.state === "ready" && data.text !== null && (
            <>
              <div className="file-preview__code" ref={sheet}>
                <pre className="file-preview__gutter" aria-hidden="true" ref={gutter}>
                  {numbers}
                </pre>
                {/* Nothing is rendered into it: what it holds is written by
                    the effect above and typed into by whoever is reading. */}
                <pre
                  className={`file-preview__text${editable ? " is-editable" : ""}`}
                  ref={setPaper}
                  suppressContentEditableWarning
                  spellCheck={false}
                  {...typing}
                  onInput={onInput}
                  onKeyUp={showCaret}
                  onBlur={() => void save()}
                />
              </div>
              {/* How far down and across the reading has been moved. */}
              <i className="file-preview__reach file-preview__reach--y" ref={down} />
              <i className="file-preview__reach file-preview__reach--x" ref={across} />
            </>
          )}
        </div>
      )}

      {!data.collapsed && data.truncated && (
        <footer className="file-preview__footer">
          {t("filePreview.truncated", { kilobytes: HEAD_KB })}
        </footer>
      )}
    </article>
  );
}

/**
 * What an editable box holds, as text.
 *
 * `textContent` alone would not answer for it: a line break in an editable box
 * can be put there as an element rather than as a newline. `innerText` answers
 * for both, but it is laid out to answer, and that is a reflow for every key
 * pressed. Walking what is there costs neither.
 */
function draftOf(root: Node): string {
  let text = "";
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? "";
    else if (node.nodeName === "BR") text += "\n";
    else text += draftOf(node);
  }
  return text.replace(/\r\n?/g, "\n");
}

/**
 * How many lines a reading has.
 *
 * A reading that ends in a newline ends there. The empty line after it is still
 * drawn — the text is shown as it is — but it is not counted, which is what an
 * editor makes of the same file.
 */
function countLines(text: string): number {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n").length;
}

/**
 * The numbers down the side of a reading, as one string.
 *
 * One string and not one element per line: sixty-four kilobytes is a few
 * thousand lines, and a gutter built out of elements puts a few thousand more
 * on a canvas whose frame is counted in elements rather than in arithmetic.
 */
function lineNumbers(count: number): string {
  const lines: string[] = [];
  for (let line = 1; line <= count; line += 1) lines.push(String(line));
  return lines.join("\n");
}

function formatSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  if (bytes < 1_000_000_000) {
    return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
  }
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
