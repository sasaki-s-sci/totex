import DOMPurify from "dompurify";
import { marked } from "marked";
import { useLayoutEffect, useRef } from "react";

// The sanitiser drops scripts and handlers itself; these are the rest: forms, frames, and overlays.
const FORBID_TAGS = ["form", "iframe", "object", "embed", "style", "link", "base"];
const FORBID_ATTR = ["style", "autofocus"];

export function MarkdownReading({ text }: { text: string }) {
  const page = useRef<HTMLDivElement>(null);

  // Written to the element: the sanitised DOM must never go back through React as markup.
  useLayoutEffect(() => {
    page.current?.replaceChildren(draw(text));
  }, [text]);

  return <div className="markdown" ref={page} />;
}

function draw(text: string): DocumentFragment {
  const page = DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true }), {
    FORBID_TAGS,
    FORBID_ATTR,
    RETURN_DOM_FRAGMENT: true,
  });

  for (const link of Array.from(page.querySelectorAll("a[href]"))) {
    const href = link.getAttribute("href") ?? "";
    link.removeAttribute("href");
    if (!link.getAttribute("title")) link.setAttribute("title", href);
  }

  return page;
}
