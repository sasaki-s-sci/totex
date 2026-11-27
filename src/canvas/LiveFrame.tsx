import { Alert, Button } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHalf, usePalette } from "../theme";
import { webAddress } from "./model";

type PageStatus = { kind: string; status?: number; reason?: string; detail?: string };

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
  const { t } = useTranslation();
  const palette = usePalette();
  const half = useHalf();
  const frame = useRef<HTMLIFrameElement>(null);
  const checkPage = useRef<(() => void) | null>(null);
  const [attempt, retry] = useState(0);
  const [checked, setChecked] = useState<(PageStatus & { url: string; attempt: number }) | null>(
    null,
  );
  const [browserFailed, setBrowserFailed] = useState(false);
  const source = useMemo(() => {
    try {
      return frameDocument(url);
    } catch {
      return null;
    }
  }, [url]);
  const local =
    source !== null &&
    /^(localhost|127\.[\d.]+|\[::1\])$/.test(new URL(url).hostname) &&
    !("__TOTEX_BROWSER_CANVAS__" in window);
  const colorFrame = useCallback(() => {
    const root = frame.current?.contentDocument?.documentElement;
    if (!root) return;
    root.style.backgroundColor = palette.background.default;
    root.style.color = palette.text.primary;
    root.style.colorScheme = half;
  }, [palette.background.default, palette.text.primary, half]);
  useLayoutEffect(colorFrame, [colorFrame]);
  useEffect(() => {
    if (!local) return;
    let live = true;
    let request = 0;
    let tries = 0;
    let timer: ReturnType<typeof setTimeout>;
    setChecked(null);
    const check = async () => {
      clearTimeout(timer);
      const current = ++request;
      const result = await invoke<PageStatus | null>("canvas_page_status", { url }).catch(
        (error): PageStatus => ({ kind: "check-failed", detail: String(error) }),
      );
      if (!live || current !== request) return;
      setChecked({ ...(result ?? { kind: "check-failed" }), url, attempt });
      // shortcut: retry startup up to 30 times; a manual reload starts another round.
      if (result?.kind === "unavailable" && ++tries < 30) timer = setTimeout(check, 2000);
    };
    checkPage.current = () => void check();
    void check();
    return () => {
      live = false;
      checkPage.current = null;
      clearTimeout(timer);
    };
  }, [url, local, attempt]);
  const status = checked?.url === url && checked.attempt === attempt ? checked : null;
  return source === null ? (
    <p role="alert">Invalid page URL: {url}</p>
  ) : local && status?.kind !== "ready" ? (
    <div className="canvas-page-status">
      <p role="status">
        {!status
          ? t("canvas.pageChecking")
          : status.kind === "frame-blocked"
            ? t("canvas.pageBlocked")
            : status.kind === "redirect-blocked"
              ? t("canvas.pageRedirect")
              : status.kind === "http-error"
                ? t("canvas.pageHttpError", { status: status.status })
                : status.kind === "check-failed"
                  ? t("canvas.pageCheckFailed")
                  : status.reason === "timeout"
                    ? t("canvas.pageTimeout")
                    : status.reason === "refused"
                      ? t("canvas.pageRefused")
                      : t("canvas.pageUnavailable")}
      </p>
      <span className="canvas-page-address">{url}</span>
      {status?.detail && <p className="canvas-page-detail">{status.detail}</p>}
      {status && (
        <div className="canvas-page-actions">
          <Button color="inherit" onClick={() => retry((value) => value + 1)}>
            {t("canvas.reloadPage")}
          </Button>
          <Button
            color="inherit"
            onClick={() => {
              setBrowserFailed(false);
              void openUrl(url).catch(() => setBrowserFailed(true));
            }}
          >
            {t("canvas.openInBrowser")}
          </Button>
        </div>
      )}
      {browserFailed && <Alert severity="error">{t("canvas.browserFailed")}</Alert>}
    </div>
  ) : (
    <iframe
      ref={frame}
      key={attempt}
      className="canvas-frame"
      data-canvas-context-menu
      title={title}
      srcDoc={source}
      sandbox="allow-scripts allow-same-origin allow-forms"
      referrerPolicy="no-referrer"
      style={{ colorScheme: half, background: palette.background.default }}
      onLoad={() => {
        colorFrame();
        // A frame's load event also fires on failure; verify with the local server.
        checkPage.current?.();
        const inner = frame.current?.contentDocument?.querySelector("iframe");
        if (inner) inner.onload = () => checkPage.current?.();
      }}
    />
  );
}
