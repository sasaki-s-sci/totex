/**
 * A markdown file drawn as the page it was written to be.
 *
 * Fetched only when a preview is opened — see `markdownPart` — because what
 * draws it is a parser and a sanitiser, and most of what this window opens is
 * not markdown.
 */

import DOMPurify from "dompurify";
import { marked } from "marked";
import { useLayoutEffect, useRef } from "react";

/**
 * What a page will not hold, whatever the file says.
 *
 * Markdown carries HTML straight through, so a file is not only what it says it
 * is: what is drawn here is whatever the file's author wrote, and what a card
 * draws is a page to be read rather than a document with a program in it. The
 * sanitiser refuses the scripts and the handlers by itself; these are the rest —
 * a form nothing could submit, a frame that would fetch, and the two ways a
 * document can lay itself over the window it is drawn in.
 */
const FORBID_TAGS = ["form", "iframe", "object", "embed", "style", "link", "base"];
const FORBID_ATTR = ["style", "autofocus"];

export function MarkdownReading({ text }: { text: string }) {
  const page = useRef<HTMLDivElement>(null);

  // Written to the element rather than rendered: what is in it is a document
  // that was sanitised into DOM, and handing it back to React as markup would
  // be the one string this must not build.
  useLayoutEffect(() => {
    page.current?.replaceChildren(draw(text));
  }, [text]);

  return <div className="markdown" ref={page} />;
}

/** The file as a page, with nothing left in it that could act. */
function draw(text: string): DocumentFragment {
  const page = DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true }), {
    FORBID_TAGS,
    FORBID_ATTR,
    RETURN_DOM_FRAGMENT: true,
  });

  // A link is drawn and says where it goes, and goes nowhere: this window is
  // not a browser, and the one thing a link in it could do is navigate the app
  // itself away from the canvas it is drawing.
  for (const link of Array.from(page.querySelectorAll("a[href]"))) {
    const href = link.getAttribute("href") ?? "";
    link.removeAttribute("href");
    if (!link.getAttribute("title")) link.setAttribute("title", href);
  }

  return page;
}
