import { useMemo } from "react";
import { webAddress } from "./model";

/** A scriptless wrapper limits navigation to the served origin, including later redirects. */
function frameDocument(address: string): string {
  const url = webAddress(address, location.origin);
  const page = document.implementation.createHTMLDocument(url.host);
  const policy = page.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; frame-src ${url.origin}; base-uri 'none'; form-action 'none'`;
  page.head.prepend(policy);
  const style = page.createElement("style");
  style.textContent =
    "html,body,iframe{width:100%;height:100%;margin:0;border:0;display:block;overflow:hidden}";
  page.head.append(style);
  const frame = page.createElement("iframe");
  frame.src = url.href;
  frame.title = url.host;
  frame.referrerPolicy = "no-referrer";
  page.body.append(frame);
  return `<!doctype html>${page.documentElement.outerHTML}`;
}

export function LiveFrame({ url, title }: { url: string; title: string }) {
  const source = useMemo(() => {
    try {
      return frameDocument(url);
    } catch {
      return null;
    }
  }, [url]);
  return source === null ? (
    <p role="alert">Invalid page URL: {url}</p>
  ) : (
    <iframe
      className="canvas-frame"
      data-canvas-context-menu
      title={title}
      srcDoc={source}
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="no-referrer"
    />
  );
}
