import DOMPurify from "dompurify";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import "./htmlReading.css";

const POLICY = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// The rail every bar in the window is drawn as (theme/rail.css), for a document that cannot see the page's sheet.
const RAIL = [
  "::-webkit-scrollbar { width: 7px; height: 7px }",
  "::-webkit-scrollbar-track, ::-webkit-scrollbar-corner { background: transparent }",
  "::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 4px;",
  "  background: rgb(0 0 0 / 0.27); background-clip: padding-box }",
  "::-webkit-scrollbar-thumb:hover { background-color: rgb(0 0 0 / 0.38) }",
].join("\n");

export function htmlDocument(text: string): string {
  const page = DOMPurify.sanitize(text, {
    WHOLE_DOCUMENT: true,
    RETURN_DOM: true,
    FORBID_TAGS: [
      "script",
      "noscript",
      "iframe",
      "frame",
      "frameset",
      "object",
      "embed",
      "base",
      "link",
      "meta",
      "form",
      "foreignObject",
      "animate",
      "animateMotion",
      "animateTransform",
      "set",
      "discard",
    ],
    FORBID_ATTR: [
      "href",
      "xlink:href",
      "action",
      "formaction",
      "target",
      "ping",
      "download",
      "srcset",
      "autofocus",
      "autoplay",
      "contenteditable",
    ],
  }) as HTMLElement;

  for (const element of page.querySelectorAll("[src], [poster], [background]")) {
    for (const attribute of ["src", "poster", "background"]) {
      const value = element.getAttribute(attribute);
      if (
        value &&
        !/^data:image\/(?:png|jpeg|gif|webp|avif|bmp|x-icon|svg\+xml)(?:;|,)/i.test(value)
      ) {
        element.removeAttribute(attribute);
      }
    }
  }

  const head =
    page.querySelector("head") ??
    page.insertBefore(document.createElement("head"), page.firstChild);
  const policy = document.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", POLICY);
  head.prepend(policy);
  const rail = document.createElement("style");
  rail.textContent = RAIL;
  head.append(rail);
  return `<!doctype html>${page.outerHTML}`;
}

export function HtmlReading({ text }: { text: string }) {
  const { t } = useTranslation();
  const source = useMemo(() => htmlDocument(text), [text]);
  return (
    <iframe
      className="html-reading nodrag nowheel"
      title={t("filePreview.htmlPreview", { defaultValue: "HTML preview" })}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={source}
    />
  );
}
