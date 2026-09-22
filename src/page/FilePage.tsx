import { type CSSProperties, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { FILE_LEAST, SETTINGS_LEAST } from "../canvas/hooks/filePreviewBox";
import { useReadingSize } from "../canvas/hooks/useReadingSize";
import {
  changed,
  fileRuns,
  patchOf,
  runBox,
  tintRuns,
  useFileDiff,
} from "../canvas/nodes/preview/diff";
import { useDraft } from "../canvas/nodes/preview/draft";
import { widthWithout } from "../canvas/nodes/preview/measure";
import { useReading } from "../canvas/nodes/preview/reading";
import type { SchemaHandle } from "../canvas/nodes/preview/SchemaReading";
import { insertTab, removeTab } from "../canvas/nodes/preview/text";
import { displayPath } from "../folder/format";
import { useAppSettings } from "../lib/appSettings";
import { drawn, vector } from "../lib/filePreview";
import type { FilePreviewNodeData } from "../lib/graph";
import {
  dxfPart,
  epubPart,
  htmlPart,
  markdownPart,
  mediaPart,
  modelPart,
  pdfPart,
  schemaPart,
  settingsPart,
  tablePart,
} from "../parts";
import type { FilePageActions } from "./actions";
import { FileTools } from "./FileTools";
import { Page } from "./Page";
import { usePageWorkspace } from "./PageWorkspace";
import { filePageId, type PagePlacement } from "./placement";

export const MIN_WIDTH = FILE_LEAST.width;
export const MIN_HEIGHT = FILE_LEAST.height;

const BORDERS = 2;

// `MAX_FILE_HEAD` in src-tauri/src/fs_browse.
const HEAD_KB = 64;

export function FilePage({
  data,
  actions,
  placement = "canvas",
}: {
  data: FilePreviewNodeData;
  actions: FilePageActions;
  placement?: PagePlacement;
}) {
  const workspace = usePageWorkspace();
  const pageId = filePageId(data.requestId);
  const { t } = useTranslation();
  const { fileTitle } = useAppSettings();
  const Settings = settingsPart.use(data.view === "settings");
  const { saveFilePreview, previewFilePreview, fitFilePreview } = actions;
  const view = useReading();
  const {
    setBody,
    sheet,
    gutter,
    setPaper,
    across,
    down,
    move,
    home,
    onWheel,
    showCaret,
    railDown,
    railMove,
    railUp,
  } = view;
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
  // A page drawn of a file is not the card asking; the card beside it is.
  const diff = useFileDiff(drawn(data.view) ? null : data.path, data.text);
  const runs = fileRuns(diff, lines);
  const patch = data.view === "diff" ? patchOf(diff, reading) : "";
  const tints = useMemo(() => tintRuns(patch), [patch]);
  const Markdown = markdownPart.use(data.view === "markdown");
  const Pdf = pdfPart.use(data.view === "pdf");
  const Dxf = dxfPart.use(data.view === "dxf");
  const isMedia = data.view === "video" || data.view === "audio";
  const Media = mediaPart.use(isMedia);
  const Html = htmlPart.use(data.view === "html");
  const Table = tablePart.use(data.view === "table");
  const Model = modelPart.use(data.view === "model");
  const Epub = epubPart.use(data.view === "epub");
  const nativeScroll =
    isMedia ||
    data.view === "html" ||
    data.view === "table" ||
    data.view === "model" ||
    data.view === "epub";
  const isDocument = data.view === "pdf" || data.view === "dxf";
  const picture =
    vector(data.path) && reading !== null && !data.truncated
      ? `data:image/svg+xml,${encodeURIComponent(reading)}`
      : data.picture;
  const ready = data.state === "ready" && (data.text !== null || picture !== null);
  const bar = useRef<HTMLElement>(null);
  const drawing = useRef<HTMLImageElement>(null);
  const [undrawn, setUndrawn] = useState<string | null>(null);
  const size = useReadingSize();

  // The reading resizes but its box does not, so the observer in useReading never sees this.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the new size is the trigger, and it is written to the card rather than read here
  useLayoutEffect(() => {
    move(0, 0);
  }, [size, move]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: what these change is the length of what is in the card, which is measured rather than read
  useLayoutEffect(() => {
    home();
  }, [data.view, patch, Markdown, home]);

  function fitWidth() {
    const header = widthWithout(bar.current, "width", "max-content");
    const held =
      data.view === "settings"
        ? SETTINGS_LEAST.width
        : nativeScroll || isDocument
          ? (bar.current?.parentElement?.clientWidth ?? data.box.width) - BORDERS
          : drawing.current?.naturalWidth || widthWithout(sheet.current, "minWidth", "0");
    fitFilePreview(data.requestId, Math.max(MIN_WIDTH, Math.max(header, held) + BORDERS));
  }

  function shrink() {
    const least = data.view === "settings" ? SETTINGS_LEAST : FILE_LEAST;
    fitFilePreview(data.requestId, least.width, least.height);
  }

  let footnote: string | null = null;
  if (data.view === "diff") {
    if (diff.truncated) footnote = t("filePreview.patchCut");
  } else if (data.truncated) {
    footnote = t("filePreview.truncated", { kilobytes: HEAD_KB });
  }

  return (
    <Page
      placement={placement}
      kind={data.view === "settings" ? "settings-page" : "file-preview"}
      name={fileTitle === "path" ? displayPath(data.path) : data.name}
      title={displayPath(data.path)}
      collapsed={placement === "canvas" && data.collapsed}
      pinned={placement === "canvas" && data.pinnedAt !== null}
      headerRef={bar}
      bodyRef={setBody}
      onBodyWheel={
        data.view === "settings" || data.view === "schema" || isDocument || nativeScroll
          ? undefined
          : onWheel
      }
      footnote={footnote}
      style={{ "--reading-size": `${size}px` } as CSSProperties}
      onPointerDown={(event) => {
        // Only when the focus is not already inside: a header press would otherwise blur the reading, which saves the file.
        const card = event.currentTarget;
        if (!card.contains(document.activeElement)) card.focus({ preventScroll: true });
      }}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "v") {
          event.preventDefault();
          void save().then((saved) => saved && previewFilePreview(data.requestId));
          return;
        }
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
          <FileTools
            data={data}
            actions={actions}
            placement={placement}
            onMove={
              workspace
                ? () => workspace.move(pageId, placement === "canvas" ? "sidebar" : "canvas")
                : undefined
            }
            onHide={workspace?.hide}
            changed={changed(diff)}
            save={save}
            onFit={fitWidth}
            onShrink={shrink}
          />
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
            {t(
              isDocument || isMedia || data.view === "model" || data.view === "epub"
                ? "filePreview.documentTooLarge"
                : data.view === "picture"
                  ? "filePreview.tooLarge"
                  : "filePreview.notText",
            )}
          </p>
        )}
      {ready && data.view === "text" && (
        <div className="file-preview__code" ref={sheet}>
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
          {/* Never rendered into: useDraft writes it, because React must not own an editable box. */}
          <pre
            className={`file-preview__text${editable ? " is-editable" : ""}`}
            ref={setPaper}
            suppressContentEditableWarning
            spellCheck={false}
            {...typing}
            onInput={onInput}
            onKeyDown={(event) => {
              if (event.key !== "Tab" || event.ctrlKey || event.altKey || event.metaKey) return;
              event.preventDefault();
              if (event.shiftKey) removeTab(event.currentTarget);
              else insertTab(event.currentTarget);
            }}
            onKeyUp={showCaret}
            onBlur={() => {
              if (!frontInactive()) void save();
            }}
          />
        </div>
      )}

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

      {ready &&
        data.view === "table" &&
        (Table ? (
          <Table text={reading ?? ""} path={data.path} truncated={data.truncated} />
        ) : (
          <p className="file-preview__message">{t("filePreview.loading")}</p>
        ))}
      {ready &&
        data.view === "model" &&
        picture !== null &&
        (Model ? (
          <Model key={picture} source={picture} name={data.name} path={data.path} />
        ) : (
          <p className="file-preview__message">{t("filePreview.loading")}</p>
        ))}
      {ready &&
        data.view === "epub" &&
        picture !== null &&
        (Epub ? (
          <Epub key={picture} source={picture} name={data.name} />
        ) : (
          <p className="file-preview__message">{t("filePreview.loading")}</p>
        ))}

      {ready &&
        data.view === "html" &&
        (Html ? (
          <Html text={reading ?? ""} />
        ) : (
          <p className="file-preview__message">{t("filePreview.loading")}</p>
        ))}
      {ready &&
        (data.view === "video" || data.view === "audio") &&
        picture !== null &&
        (Media ? (
          <Media key={picture} source={picture} name={data.name} kind={data.view} />
        ) : (
          <p className="file-preview__message">{t("filePreview.loading")}</p>
        ))}

      {ready &&
        isDocument &&
        picture !== null &&
        (data.view === "pdf" && Pdf ? (
          <Pdf key={picture} source={picture} name={data.name} />
        ) : data.view === "dxf" && Dxf ? (
          <Dxf key={picture} source={picture} name={data.name} />
        ) : (
          <p className="file-preview__message">{t("filePreview.loading")}</p>
        ))}

      {ready &&
        !isDocument &&
        !nativeScroll &&
        data.view !== "settings" &&
        data.view !== "schema" && (
          <>
            <i
              className="file-preview__reach file-preview__reach--y"
              ref={down}
              onPointerDown={railDown("y")}
              onPointerMove={railMove}
              onPointerUp={railUp}
              onPointerCancel={railUp}
            />
            <i
              className="file-preview__reach file-preview__reach--x"
              ref={across}
              onPointerDown={railDown("x")}
              onPointerMove={railMove}
              onPointerUp={railUp}
              onPointerCancel={railUp}
            />
          </>
        )}
    </Page>
  );
}

import { frontInactive } from "../shell/bridge";
