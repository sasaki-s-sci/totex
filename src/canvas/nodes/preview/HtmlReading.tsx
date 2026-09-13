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

/** Keep the document's layout inside an inert, opaque-origin frame. */
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

  // Prepend the policy before any untrusted styles or resources are parsed by
  // the iframe. Never attach the sanitized document to the application DOM.
  const head =
    page.querySelector("head") ??
    page.insertBefore(document.createElement("head"), page.firstChild);
  const policy = document.createElement("meta");
  policy.setAttribute("http-equiv", "Content-Security-Policy");
  policy.setAttribute("content", POLICY);
  head.prepend(policy);
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
