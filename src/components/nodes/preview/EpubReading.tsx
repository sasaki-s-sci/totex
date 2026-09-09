import ePub, { type Book, type Contents, type Rendition } from "epubjs";
import type { NavItem } from "epubjs/types/navigation";
import type Section from "epubjs/types/section";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { sourceBytes } from "./documentSource";
import { cleanEpubDocument, internalEpubLink, prepareEpub } from "./epubSource";
import "./epubReading.css";

function navigation(items: NavItem[], depth = 0): { href: string; label: string }[] {
  return items.flatMap((item) => [
    ...(internalEpubLink(item.href)
      ? [{ href: item.href, label: `${"　".repeat(Math.min(depth, 6))}${item.label.trim()}` }]
      : []),
    ...navigation(item.subitems ?? [], depth + 1),
  ]);
}

export function EpubReading({ source, name }: { source: string; name: string }) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const rendition = useRef<Rendition | null>(null);
  const [toc, setToc] = useState<{ href: string; label: string }[]>([]);
  const [chapter, setChapter] = useState("");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    void attempt;
    const container = viewport.current;
    if (!container) return;
    const controller = new AbortController();
    let book: Book | undefined;
    let observer: ResizeObserver | undefined;
    let opened = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const active = () => !controller.signal.aborted;
    const fail = () => {
      if (active()) {
        setFailed(true);
        setLoading(false);
      }
    };
    const mount = document.createElement("div");
    mount.className = "epub-reading__mount";
    container.replaceChildren(mount);
    setLoading(true);
    setFailed(false);
    setToc([]);
    setChapter("");

    void (async () => {
      try {
        const data = await prepareEpub(sourceBytes(source), controller.signal);
        if (!active()) return;
        book = ePub({
          replacements: "blobUrl",
          requestMethod: () => Promise.reject(new Error("external-epub-resource")),
        });
        await book.open(data, "binary");
        opened = true;
        if (!active()) {
          book.destroy();
          return;
        }
        // Spine items are XHTML even when their archive paths have no extension.
        const archive = book.archive;
        const load = book.load.bind(book);
        const chapterUrls = new Set<string>();
        book.spine.each((section: Section) => chapterUrls.add(section.url));
        book.load = (path: string) =>
          chapterUrls.has(path)
            ? archive.request(path, "xhtml").then((document) => {
                if (!(document instanceof Document)) throw new Error("invalid-epub-chapter");
                return document;
              })
            : load(path);
        book.spine.hooks.serialize.register((_output: string, section: Section) => {
          section.output = cleanEpubDocument(section.output, true, true);
        });
        const reader = book.renderTo(mount, {
          width: Math.max(1, container.clientWidth),
          height: Math.max(1, container.clientHeight),
          flow: "auto",
          spread: "none",
          allowScriptedContent: false,
        });
        rendition.current = reader;
        reader.hooks.content.register((contents: Contents) => {
          // EPUB.js handles in-book links; browser navigation itself stays disabled.
          contents.document.addEventListener(
            "click",
            (event) => {
              const target = event.target;
              const element = target && "closest" in target ? (target as Element) : null;
              const anchor = element?.closest("a");
              if (!anchor) return;
              event.preventDefault();
              event.stopImmediatePropagation();
              const href = anchor.getAttribute("href");
              const section = book?.spine.get(contents.sectionIndex);
              if (!href || !section || !internalEpubLink(href)) return;
              const destination = new URL(href, new URL(section.href, "https://epub.invalid/"));
              void reader.display(destination.pathname.slice(1) + destination.hash).catch(fail);
            },
            true,
          );
          contents.document.documentElement.lang ||= "en";
        });
        reader.on("displayError", fail);
        reader.on("relocated", (location: { start: { href: string } }) => {
          if (active()) setChapter(location.start.href);
        });
        const contents = await book.loaded.navigation;
        if (!active()) return;
        setToc(navigation(contents.toc));
        await reader.display();
        if (!active()) return;
        observer = new ResizeObserver(() => {
          if (active() && container.clientWidth && container.clientHeight)
            reader.resize(container.clientWidth, container.clientHeight);
        });
        observer.observe(container);
        if (active()) setLoading(false);
      } catch {
        fail();
      } finally {
        if (timer) clearTimeout(timer);
      }
    })();
    timer = setTimeout(fail, 20_000);
    return () => {
      controller.abort();
      clearTimeout(timer);
      observer?.disconnect();
      if (rendition.current?.book === book) rendition.current = null;
      // Opening has no cancellation API: let it settle before destroying its internals.
      if (opened) book?.destroy();
      mount.remove();
    };
  }, [source, attempt]);

  const move = (target: "prev" | "next" | { href: string }) => {
    const reader = rendition.current;
    if (!reader) return;
    setFailed(false);
    const pending = typeof target === "string" ? reader[target]() : reader.display(target.href);
    void pending.catch(() => {
      if (rendition.current === reader) setFailed(true);
    });
  };
  return (
    <section className="epub-reading nodrag nowheel" aria-label={name}>
      <div className="file-preview__document-tools">
        <button
          type="button"
          disabled={loading || failed}
          onClick={() => move("prev")}
          aria-label={t("filePreview.epubPrevious", { defaultValue: "Previous page" })}
        >
          ‹
        </button>
        <select
          aria-label={t("filePreview.epubContents", { defaultValue: "Table of contents" })}
          disabled={loading || !toc.length}
          value={toc.find((item) => item.href.split("#")[0] === chapter.split("#")[0])?.href ?? ""}
          onChange={(event) => move({ href: event.target.value })}
        >
          <option value="" disabled>
            {t("filePreview.epubContents", { defaultValue: "Table of contents" })}
          </option>
          {toc.map((item) => (
            <option key={item.href} value={item.href}>
              {item.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={loading || failed}
          onClick={() => move("next")}
          aria-label={t("filePreview.epubNext", { defaultValue: "Next page" })}
        >
          ›
        </button>
      </div>
      <div className="epub-reading__body">
        <div ref={viewport} className="epub-reading__viewport" />
        {loading && (
          <div className="epub-reading__status" role="status">
            {t("filePreview.epubLoading", { defaultValue: "Loading book…" })}
          </div>
        )}
        {failed && (
          <div className="epub-reading__status" role="alert">
            {t("filePreview.epubFailed", {
              defaultValue:
                "This EPUB could not be opened. Encrypted or oversized books are not supported.",
            })}
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              {t("filePreview.epubRetry", { defaultValue: "Retry" })}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
