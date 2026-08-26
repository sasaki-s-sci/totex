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
import { type CSSProperties, useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useReadingSize } from "../../hooks/useReadingSize";
import type { FilePreviewFlowNode, FilePreviewNodeData } from "../../lib/graph";
import { useGraphActions } from "../graphActions";
import { useDraft } from "./preview/draft";
import { widthWithout } from "./preview/measure";
import { useReading } from "./preview/reading";
import { formatSize } from "./preview/text";

/** The smallest box a reading is still worth drawing in. */
export const MIN_WIDTH = 180;
export const MIN_HEIGHT = 96;

/** The card's own edge, which stands outside everything measured inside it. */
const BORDERS = 2;

/** How much of a file is read at all. `MAX_FILE_HEAD` in src-tauri/src/fs_browse. */
const HEAD_KB = 64;

/** A card standing on the canvas: the grips that resize it, and the card itself.
 *  A pinned card is not one of these — it has left the canvas, and the grips are
 *  React Flow's and drawn in the canvas's own coordinates. */
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

/** The card itself: a file's reading, and what can be done to it. Drawn the same
 *  as the body of a node and on the layer over the canvas once pinned — which of
 *  the two it is in is not something it has to know. */
export function FilePreviewCard({ data }: { data: FilePreviewNodeData }) {
  const { t } = useTranslation();
  const { closeFilePreview, saveFilePreview, collapseFilePreview, fitFilePreview, pinFilePreview } =
    useGraphActions();
  const detail = data.size === null ? null : formatSize(data.size);
  const view = useReading();
  const { setBody, sheet, gutter, setPaper, across, down, move, onWheel, showCaret } = view;
  const { editable, numbers, unsaved, refused, save, typing, onInput } = useDraft(
    data,
    view,
    saveFilePreview,
  );
  /** The header, measured alongside the reading when the card is asked to fit:
   *  the name in it is as much what the card is showing as the lines are. */
  const bar = useRef<HTMLElement>(null);
  // How large the reading is drawn, for every card at once. Ctrl and a plus or
  // a minus is what changes it, for as long as a card has the focus;
  // `useReadingKeys` in the graph listens for them.
  const size = useReadingSize();

  // A reading drawn larger or smaller comes to a different size on the page, so
  // how far it can be moved changes with it. Its box did not, and the box is
  // what the observer inside `useReading` watches, so it is settled here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the new size is the trigger, and it is written to the card rather than read here
  useLayoutEffect(() => {
    move(0, 0);
  }, [size, move]);

  /** Puts the card at the width of what is in it: the wider of the longest line
   *  of the reading and the header, whose name goes to an ellipsis long before
   *  the lines run out. The width and nothing else — no height fits a file. */
  function fitWidth() {
    const header = widthWithout(bar.current, "width", "max-content");
    const reading = widthWithout(sheet.current, "minWidth", "0");
    fitFilePreview(data.requestId, Math.max(MIN_WIDTH, Math.max(header, reading) + BORDERS));
  }

  // A file the card holds only the head of is read and never written: what is
  // on screen is what would go to disk, and the rest of the file would go with
  // it. The backend refuses the same write; this is what keeps the card from
  // offering it.
  return (
    <article
      className={`file-preview${data.collapsed ? " is-collapsed" : ""}${
        data.pinnedAt ? " is-pinned" : ""
      }`}
      // A stop of the card's own, out of the way of tabbing: a reading that can
      // be typed into takes the focus itself, and one that cannot has nothing
      // inside it that would. Both are being read, and how large a reading is
      // drawn is a question the card that has the focus answers.
      tabIndex={-1}
      // Said once on the card, so that the gutter and the text are always the
      // same size as one another, and so that the size is the only thing the
      // stylesheet gives up.
      style={{ "--reading-size": `${size}px` } as CSSProperties}
      onPointerDown={(event) => {
        // A card pressed anywhere is the card in hand. The reading, a button in
        // the header and the header being taken hold of would each leave the
        // focus somewhere different — one of them nowhere at all — so the card
        // takes it here, before any of that, and whatever inside it can hold
        // the focus takes it from the card a moment later.
        //
        // Only when it is not already inside the card: a header pressed while
        // the reading is being typed into would otherwise take the focus out of
        // it, and out of a reading is where a file is written back to disk.
        const card = event.currentTarget;
        if (!card.contains(document.activeElement)) card.focus({ preventScroll: true });
      }}
      onKeyDown={(event) => {
        // What every other window keeps a file with. There is nothing else to
        // press inside a card: one put away or clicked out of keeps itself,
        // and how large the reading is drawn is Ctrl and a plus or a minus,
        // which the window listens for on behalf of the card that has the focus.
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
            <PushPinIcon sx={{ fontSize: 12 }} />
          ) : (
            <PushPinOutlinedIcon sx={{ fontSize: 12 }} />
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
          <HeightIcon sx={{ fontSize: 12, transform: "rotate(90deg)" }} />
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
            <KeyboardArrowDownIcon sx={{ fontSize: 12 }} />
          ) : (
            <KeyboardArrowUpIcon sx={{ fontSize: 12 }} />
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
          <CloseIcon sx={{ fontSize: 12 }} />
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
