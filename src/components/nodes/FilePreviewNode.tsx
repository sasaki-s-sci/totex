import type { NodeProps } from "@xyflow/react";
import { type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useReadingSize } from "../../hooks/useReadingSize";
import { useAppSettings } from "../../lib/appSettings";
import { drawn, vector } from "../../lib/filePreview";
import type { FilePreviewFlowNode, FilePreviewNodeData } from "../../lib/graph";
import { markdownPart, schemaPart, settingsPart } from "../../parts";
import { useGraphActions } from "../graphActions";
import { Page, PageFrame } from "./Page";
import { changed, fileRuns, patchOf, runBox, tintRuns, useFileDiff } from "./preview/diff";
import { useDraft } from "./preview/draft";
import { widthWithout } from "./preview/measure";
import { useReading } from "./preview/reading";
import type { SchemaHandle } from "./preview/SchemaReading";
import { formatSize } from "./preview/text";
import { FileTools } from "./preview/tools";

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
      <PageFrame
        minWidth={data.view === "settings" ? 520 : MIN_WIDTH}
        minHeight={data.view === "settings" ? 220 : MIN_HEIGHT}
        widthOnly={data.collapsed}
      />
      <FilePreviewCard data={data} />
    </>
  );
}

/** The card itself: a file's reading, and what can be done to it. Drawn in the
 *  panel every page of this canvas is drawn in — see `Page` — and on the layer
 *  over the canvas once pinned, which of the two it is in is not something it
 *  has to know. */
export function FilePreviewCard({ data }: { data: FilePreviewNodeData }) {
  const { t } = useTranslation();
  const { fileTitle } = useAppSettings();
  const Settings = settingsPart.use(data.view === "settings");
  const { saveFilePreview, previewFilePreview, fitFilePreview } = useGraphActions();
  const detail = data.size === null ? null : formatSize(data.size);
  const view = useReading();
  const { setBody, sheet, gutter, setPaper, across, down, move, home, onWheel, showCaret } = view;
  const {
    editable,
    reading,
    lines,
    numbers,
    unsaved,
    refused,
    save: saveNative,
    typing,
    onInput,
  } = useDraft(data, view, saveFilePreview);
  const Schema = schemaPart.use(data.view === "schema");
  const schemaRef = useRef<SchemaHandle>(null);
  const save = () =>
    data.view === "schema" ? (schemaRef.current?.save() ?? Promise.resolve(true)) : saveNative();
  // What became of the file since the commit under it: the bars down the gutter,
  // and the patch the header offers in place of the reading. A card drawing a
  // page of its file is not the one asking — the file it is a page of is the
  // card standing beside it, and that one has the question.
  const diff = useFileDiff(drawn(data.view) ? null : data.path, data.text);
  const runs = fileRuns(diff, lines);
  const patch = data.view === "diff" ? patchOf(diff, reading) : "";
  const tints = useMemo(() => tintRuns(patch), [patch]);
  // What draws a page, fetched the first time one is opened and never before.
  const Markdown = markdownPart.use(data.view === "markdown");
  const picture =
    vector(data.path) && reading !== null && !data.truncated
      ? `data:image/svg+xml,${encodeURIComponent(reading)}`
      : data.picture;
  /** There is something in the card that can be moved about. */
  const ready = data.state === "ready" && (data.text !== null || picture !== null);
  /** The header, measured alongside the reading when the card is asked to fit:
   *  the name in it is as much what the card is showing as the lines are. */
  const bar = useRef<HTMLElement>(null);
  /** The picture, which is the one thing a card holds that has a width of its
   *  own rather than the one the card gave it. */
  const drawing = useRef<HTMLImageElement>(null);
  /**
   * The picture the engine would not draw, if it has met one.
   *
   * Which picture rather than that there was one: what a file is called says
   * what it is meant to be and its bytes say what it is, and the two
   * disagreeing is a card that says so — about those bytes and no others.
   */
  const [undrawn, setUndrawn] = useState<string | null>(null);
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

  // A card turned over is holding something else of another length, and how far
  // down the reading had been moved has nothing to do with what is there now.
  // The page is the same again: it is drawn into the card by the part above, so
  // what it comes to is only known once that part is in hand.
  // biome-ignore lint/correctness/useExhaustiveDependencies: what these change is the length of what is in the card, which is measured rather than read
  useLayoutEffect(() => {
    home();
  }, [data.view, patch, Markdown, home]);

  /** Puts the card at the width of what is in it: the wider of the longest line
   *  of the reading and the header, whose name goes to an ellipsis long before
   *  the lines run out. The width and nothing else — no height fits a file. */
  function fitWidth() {
    const header = widthWithout(bar.current, "width", "max-content");
    // A picture is fitted to the picture. It is drawn inside whatever the card
    // is, so there is nothing on the page to measure it by — what it would come
    // to at its own size is the one thing it can say, and the canvas holds that
    // to the room there is on screen the same way it holds a line of text. A
    // drawing has no size of its own and answers with none, which leaves the
    // card measured the way every other one is.
    const held =
      data.view === "settings"
        ? 520
        : drawing.current?.naturalWidth || widthWithout(sheet.current, "minWidth", "0");
    fitFilePreview(data.requestId, Math.max(MIN_WIDTH, Math.max(header, held) + BORDERS));
  }

  // What the card is holding only part of, which is a different part in each of
  // the two: a file is read as far as a card is given, and a patch is printed as
  // far as one is worth sending.
  let footnote: string | null = null;
  if (data.view === "diff") {
    if (diff.truncated) footnote = t("filePreview.patchCut");
  } else if (data.truncated) {
    footnote = t("filePreview.truncated", { kilobytes: HEAD_KB });
  }

  // A file the card holds only the head of is read and never written: what is
  // on screen is what would go to disk, and the rest of the file would go with
  // it. The backend refuses the same write; this is what keeps the card from
  // offering it.
  return (
    <Page
      kind={data.view === "settings" ? "settings-page" : "file-preview"}
      name={fileTitle === "path" ? data.path : data.name}
      title={data.path}
      collapsed={data.collapsed}
      pinned={data.pinnedAt !== null}
      headerRef={bar}
      bodyRef={setBody}
      onBodyWheel={data.view === "settings" || data.view === "schema" ? undefined : onWheel}
      footnote={footnote}
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
        // The file beside itself, drawn as the page it is written to be. Taken
        // from the paste it would otherwise be inside a reading, which is the
        // one place this press already means anything — and taken with what is
        // being typed, because a page is drawn from the file on disk.
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "v") {
          event.preventDefault();
          void save().then((saved) => saved && previewFilePreview(data.requestId));
          return;
        }
        // What every other window keeps a file with. There is nothing else to
        // press inside a card: one put away or clicked out of keeps itself,
        // and how large the reading is drawn is Ctrl and a plus or a minus,
        // which the window listens for on behalf of the card that has the focus.
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
          event.preventDefault();
          void save();
        }
      }}
      tools={
        <>
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
          <FileTools data={data} changed={changed(diff)} save={save} onFit={fitWidth} />
        </>
      }
    >
      {data.view === "settings" &&
        (Settings ? (
          <Settings />
        ) : (
          <p className="file-preview__message">{t("filePreview.loading")}</p>
        ))}
      {data.view === "schema" &&
        data.state === "ready" &&
        (Schema ? (
          <Schema data={data} ref={schemaRef} write={saveFilePreview} />
        ) : (
          <p className="file-preview__message">{t("filePreview.loading")}</p>
        ))}
      {data.state === "loading" && (
        <p className="file-preview__message">{t("filePreview.loading")}</p>
      )}
      {data.state === "failed" && (
        <p className="file-preview__message is-error">{t("filePreview.failed")}</p>
      )}
      {data.view !== "settings" &&
        data.state === "ready" &&
        data.text === null &&
        picture === null && (
          <p className="file-preview__message">
            {t(data.view === "picture" ? "filePreview.tooLarge" : "filePreview.notText")}
          </p>
        )}
      {ready && data.view === "text" && (
        <div className="file-preview__code" ref={sheet}>
          {/* The numbers, and the bars saying what became of the lines beside
              them. Both stay where they are while the reading is moved across,
              so they are moved back as one. */}
          <div className="file-preview__rule" aria-hidden="true" ref={gutter}>
            <pre className="file-preview__gutter">{numbers}</pre>
            {runs.map((run) => (
              <i
                key={`${run.mark}:${run.line}`}
                className={`file-preview__mark is-${run.mark}`}
                style={runBox(run.line - 1, run.lines)}
              />
            ))}
          </div>
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
      )}

      {/* The patch, drawn the way the reading is: one block of text, with what
          each line of it is said in a bar behind it rather than in an element
          per line. */}
      {ready && data.view === "diff" && (
        <div className="file-preview__patch" ref={sheet}>
          {tints.map((run) => (
            <i
              key={`${run.tint}:${run.from}`}
              className={`file-preview__tint is-${run.tint}`}
              style={runBox(run.from, run.lines)}
            />
          ))}
          <pre className="file-preview__text">{patch}</pre>
        </div>
      )}

      {/* The picture, drawn whole inside whatever the card is: an edge dragged
          is what it is read larger at, and the canvas's own zoom is the other.
          Nothing of it is this app's to read — the bytes go to the engine as
          they came off the disk. */}
      {ready && data.view === "picture" && picture !== null && (
        <div
          className={`file-preview__picture${vector(data.path) ? " is-drawing" : ""}`}
          ref={sheet}
        >
          {undrawn === picture ? (
            <p className="file-preview__message">{t("filePreview.notPicture")}</p>
          ) : (
            <img
              src={picture}
              alt={data.name}
              ref={drawing}
              draggable={false}
              onError={() => setUndrawn(picture)}
            />
          )}
        </div>
      )}

      {ready && data.view === "markdown" && (
        <div className="file-preview__markdown" ref={sheet}>
          {Markdown ? (
            <Markdown text={reading ?? ""} />
          ) : (
            <p className="file-preview__message">{t("filePreview.loading")}</p>
          )}
        </div>
      )}

      {/* How far down and across what is in the card has been moved. */}
      {ready && data.view !== "settings" && data.view !== "schema" && (
        <>
          <i className="file-preview__reach file-preview__reach--y" ref={down} />
          <i className="file-preview__reach file-preview__reach--x" ref={across} />
        </>
      )}
    </Page>
  );
}
