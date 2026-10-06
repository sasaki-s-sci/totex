import { openUrl } from "@tauri-apps/plugin-opener";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/common";
import { Marked } from "marked";
import markedFootnote from "marked-footnote";
import { useEffect, useLayoutEffect, useRef } from "react";
import { readFileData } from "../../../folder/api";
import { pictureType } from "../../../lib/filePreview";
import { linkTarget, pictureTarget, slugOf } from "./markdownTargets";

// The sanitiser drops scripts and handlers itself; these are the rest: forms, frames, and overlays.
const FORBID_TAGS = ["form", "iframe", "object", "embed", "style", "link", "base"];
const FORBID_ATTR = ["style", "autofocus"];

const ALERTS = ["note", "tip", "important", "warning", "caution"];

const marked = new Marked({ async: false, gfm: true }, markedFootnote({ footnoteDivider: true }));

export function MarkdownReading({
  text,
  path,
  onOpenFile,
}: {
  text: string;
  /** The file the text is read from: relative links and pictures are found beside it. */
  path: string;
  onOpenFile?: (path: string) => void;
}) {
  const page = useRef<HTMLDivElement>(null);
  const open = useRef(onOpenFile);
  open.current = onOpenFile;
  // Pictures on disk, held so that a redraw while typing does not flicker them.
  const pictures = useRef(new Map<string, string | null>());

  // Written to the element: the sanitised DOM must never go back through React as markup.
  useLayoutEffect(() => {
    const host = page.current;
    if (!host) return;
    const drawing = draw(text, path);
    host.replaceChildren(drawing.page);
    let live = true;
    for (const { image, path: file } of drawing.files) {
      const held = pictures.current.get(file);
      if (held !== undefined) {
        if (held) image.src = held;
        continue;
      }
      const type = pictureType(file);
      if (!type) continue;
      readFileData(file)
        .then((read) => (read.data === null ? null : `data:${type};base64,${read.data}`))
        .catch(() => null)
        .then((source) => {
          pictures.current.set(file, source);
          if (live && source) image.src = source;
        });
    }
    return () => {
      live = false;
    };
  }, [text, path]);

  useEffect(() => {
    const host = page.current;
    if (!host) return;
    const follow = (link: Element) => {
      const target = linkTarget(link.getAttribute("data-href") ?? "", path);
      if (!target) return;
      if (target.kind === "anchor") {
        const name = target.name;
        const found = Array.from(host.querySelectorAll("[data-anchor]")).find(
          (element) => element.getAttribute("data-anchor") === name,
        );
        found?.scrollIntoView({ block: "start" });
      } else if (target.kind === "web") {
        void openUrl(target.url).catch((error) => console.error("Could not open link", error));
      } else {
        open.current?.(target.path);
      }
    };
    const click = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const link = (event.target as Element | null)?.closest?.("a[data-href]");
      if (!link || !host.contains(link)) return;
      // The end of a selection dragged across a link is not a press on it.
      if (!(window.getSelection()?.isCollapsed ?? true)) return;
      event.preventDefault();
      follow(link);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const link = (event.target as Element | null)?.closest?.("a[data-href]");
      if (!link || !host.contains(link)) return;
      event.preventDefault();
      follow(link);
    };
    host.addEventListener("click", click);
    host.addEventListener("keydown", key);
    return () => {
      host.removeEventListener("click", click);
      host.removeEventListener("keydown", key);
    };
  }, [path]);

  return <div className="markdown" ref={page} />;
}

type Drawing = {
  page: DocumentFragment;
  /** Pictures on disk, still to be read through the host. */
  files: { image: HTMLImageElement; path: string }[];
};

function draw(text: string, path: string): Drawing {
  const { front, body } = frontMatter(text);
  const page = DOMPurify.sanitize(marked.parse(body) as string, {
    FORBID_TAGS,
    FORBID_ATTR,
    RETURN_DOM_FRAGMENT: true,
  });

  if (front !== null) {
    const block = document.createElement("pre");
    block.className = "markdown__front";
    const code = document.createElement("code");
    code.textContent = front;
    block.append(code);
    page.prepend(block);
  }

  // Ids would clash between cards on the one document; anchors are looked up within the page.
  for (const element of Array.from(page.querySelectorAll("[id]"))) {
    element.setAttribute("data-anchor", element.id);
    element.removeAttribute("id");
  }
  const slugs = new Map<string, number>();
  for (const heading of Array.from(page.querySelectorAll("h1, h2, h3, h4, h5, h6"))) {
    const slug = slugOf(heading.textContent ?? "");
    const seen = slugs.get(slug) ?? 0;
    slugs.set(slug, seen + 1);
    if (!heading.hasAttribute("data-anchor"))
      heading.setAttribute("data-anchor", seen ? `${slug}-${seen}` : slug);
  }

  // A link never navigates the window; it is followed by the page's own click.
  for (const link of Array.from(page.querySelectorAll("a[href]"))) {
    const href = link.getAttribute("href") ?? "";
    link.removeAttribute("href");
    if (!linkTarget(href, path)) continue;
    link.setAttribute("data-href", href);
    link.setAttribute("role", "link");
    link.setAttribute("tabindex", "0");
    if (!link.getAttribute("title") && !href.startsWith("#")) link.setAttribute("title", href);
  }

  // A <picture> source is only kept when it can be drawn as it is; the <img> inside is the rest.
  for (const source of Array.from(page.querySelectorAll("source[srcset]"))) {
    if (!webOnly(source.getAttribute("srcset") ?? "", path)) source.remove();
  }
  const files: Drawing["files"] = [];
  for (const image of Array.from(page.querySelectorAll("img"))) {
    image.setAttribute("referrerpolicy", "no-referrer");
    if (image.hasAttribute("srcset") && !webOnly(image.getAttribute("srcset") ?? "", path))
      image.removeAttribute("srcset");
    const target = pictureTarget(image.getAttribute("src") ?? "", path);
    if (target?.kind === "web") {
      image.setAttribute("src", target.url);
    } else {
      image.removeAttribute("src");
      if (target?.kind === "file") files.push({ image, path: target.path });
    }
  }

  for (const quote of Array.from(page.querySelectorAll("blockquote"))) alert(quote);

  for (const code of Array.from(page.querySelectorAll("pre > code[class*='language-']"))) {
    const language = code.className.match(/language-(\S+)/)?.[1];
    if (!language || !hljs.getLanguage(language)) continue;
    // Highlighted from the text alone: what comes back is hljs's own escaped markup.
    code.innerHTML = hljs.highlight(code.textContent ?? "", { language }).value;
    code.classList.add("hljs");
  }

  return { page, files };
}

/** Every candidate in a srcset is on the web. */
function webOnly(srcset: string, path: string): boolean {
  const candidates = srcset
    .split(",")
    .map((candidate) => candidate.trim().split(/\s+/)[0])
    .filter(Boolean);
  return (
    candidates.length > 0 &&
    candidates.every((candidate) => pictureTarget(candidate, path)?.kind === "web")
  );
}

/** `> [!NOTE]` and its kin, drawn as GitHub draws them. */
function alert(quote: Element): void {
  const first = quote.firstElementChild;
  if (first?.tagName !== "P") return;
  const lead = first.firstChild;
  if (lead?.nodeType !== Node.TEXT_NODE) return;
  const marker = lead.textContent?.match(/^\s*\[!(\w+)\]\s*/);
  const kind = marker?.[1].toLowerCase();
  if (!marker || !kind || !ALERTS.includes(kind)) return;
  lead.textContent = (lead.textContent ?? "").slice(marker[0].length);
  if (!first.textContent?.trim()) first.remove();
  const title = document.createElement("p");
  title.className = "markdown-alert__title";
  title.textContent = kind[0].toUpperCase() + kind.slice(1);
  quote.prepend(title);
  quote.classList.add("markdown-alert", `markdown-alert--${kind}`);
}

/** YAML front matter, held apart so it is not read as a rule and a heading. */
function frontMatter(text: string): { front: string | null; body: string } {
  const found = text.match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/);
  if (!found) return { front: null, body: text };
  return { front: found[1], body: text.slice(found[0].length) };
}
