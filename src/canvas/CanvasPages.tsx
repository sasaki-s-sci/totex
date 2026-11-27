import { Alert, ButtonBase, Menu, MenuItem } from "@mui/material";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyText } from "../lib/clipboard";
import type { CanvasPage } from "./pages";

export type CanvasPageGroup = { sessionId: string; number: number; pages: readonly CanvasPage[] };

export function CanvasPages({
  groups,
  shown,
  open,
}: {
  groups: readonly CanvasPageGroup[];
  shown: boolean;
  open: (url: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const host = useRef<HTMLDivElement>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ url: string; top: number; left: number } | null>(null);
  const [error, setError] = useState<"terminal.openFailed" | "terminal.copyFailed" | null>(null);
  useEffect(() => {
    if (!shown) setMenu(null);
  }, [shown]);
  const openPage = (url: string) => {
    setMenu(null);
    setOpening(url);
    setError(null);
    void open(url)
      .catch(() => setError("terminal.openFailed"))
      .finally(() => setOpening(null));
  };
  return (
    <div ref={host} className={`canvas-empty${groups.length ? " canvas-pages" : ""}`}>
      {groups.map((group, groupIndex) => (
        <section
          className="canvas-page-group"
          key={group.sessionId}
          aria-labelledby={`${descriptionId}-group-${groupIndex}`}
        >
          <h2 id={`${descriptionId}-group-${groupIndex}`}>
            {t("canvas.selectTerminal", { number: group.number })}
          </h2>
          <ul>
            {group.pages.map((page, index) => (
              <li key={page.url}>
                <ButtonBase
                  className="canvas-page-link"
                  disabled={opening !== null}
                  aria-label={t("canvas.openCollectedUrl", { url: page.url })}
                  aria-describedby={`${descriptionId}-${groupIndex}-${index}`}
                  onClick={() => openPage(page.url)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setMenu({ url: page.url, top: event.clientY, left: event.clientX });
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10"))
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    const bounds = event.currentTarget.getBoundingClientRect();
                    setMenu({ url: page.url, top: bounds.top, left: bounds.left });
                  }}
                >
                  <code
                    className="canvas-page-command"
                    id={`${descriptionId}-${groupIndex}-${index}`}
                  >
                    {page.command}
                  </code>
                  <span className="canvas-page-url">{page.url}</span>
                </ButtonBase>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {t(error)}
        </Alert>
      )}
      <Menu
        open={menu !== null}
        onClose={() => setMenu(null)}
        container={() => host.current?.closest("dialog[open]") ?? document.body}
        anchorReference="anchorPosition"
        anchorPosition={menu ?? undefined}
      >
        <MenuItem disabled={opening !== null} onClick={() => menu && openPage(menu.url)}>
          {t("terminal.openUrl")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (!menu) return;
            setMenu(null);
            setError(null);
            void openUrl(menu.url).catch(() => setError("terminal.openFailed"));
          }}
        >
          {t("terminal.openUrlInBrowser")}
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (!menu) return;
            setMenu(null);
            setError(null);
            void copyText(menu.url).catch(() => setError("terminal.copyFailed"));
          }}
        >
          {t("terminal.copyUrl")}
        </MenuItem>
      </Menu>
    </div>
  );
}
