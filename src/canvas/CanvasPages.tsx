import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { ButtonBase } from "@mui/material";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasPage } from "./pages";

export function CanvasPages({
  pages,
  open,
}: {
  pages: readonly CanvasPage[];
  open: (url: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const descriptionId = useId();
  const [opening, setOpening] = useState<string | null>(null);
  return (
    <div className={`canvas-empty${pages.length ? " canvas-pages" : ""}`}>
      {pages.length > 0 && (
        <>
          <h2>{t("canvas.folderPages")}</h2>
          <ul aria-label={t("canvas.folderPages")}>
            {pages.map((page, index) => (
              <li key={page.url}>
                <ButtonBase
                  className="canvas-page-link"
                  disabled={opening !== null}
                  aria-label={t("canvas.openCollectedUrl", { url: page.url })}
                  aria-describedby={`${descriptionId}-${index}`}
                  onClick={() => {
                    setOpening(page.url);
                    void open(page.url)
                      .catch(() => undefined)
                      .finally(() => setOpening(null));
                  }}
                >
                  <span className="canvas-page-details">
                    <span className="canvas-page-url">{page.url}</span>
                    <code id={`${descriptionId}-${index}`}>
                      {page.command ?? t("canvas.unknownCommand")}
                    </code>
                  </span>
                  <ArrowForwardIcon fontSize="small" />
                </ButtonBase>
              </li>
            ))}
          </ul>
        </>
      )}
      <p>{t("canvas.keys")}</p>
    </div>
  );
}
