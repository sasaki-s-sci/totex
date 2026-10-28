import CloseIcon from "@mui/icons-material/Close";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Frame } from "../marks";
import { PageTool } from "./Page";
import type { PagePlacement } from "./placement";

export type PageControls = {
  viewer?: boolean;
  move?: () => void;
  close?: () => void;
  hide?: () => void;
};

/** A capability is a real action, never a placeholder that silently does nothing. */
export function PageTools({
  name,
  placement,
  controls,
  children,
}: {
  name: string;
  placement: PagePlacement;
  controls: PageControls;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const icon = { fontSize: 12 };
  return (
    <>
      {children}
      {controls.move && (
        <PageTool
          className={placement === "sidebar" ? "page__to-canvas" : undefined}
          label={t(
            controls.viewer
              ? placement === "canvas"
                ? "page.openViewer"
                : "page.closeViewer"
              : placement === "canvas"
                ? "page.toSidebar"
                : "page.toCanvas",
            { name },
          )}
          onClick={controls.move}
        >
          <Frame size={12}>
            {placement === "canvas" ? (
              <>
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M15 4v16M6 12h6m-3-3 3 3-3 3" />
              </>
            ) : (
              <>
                <rect x="3" y="4" width="7" height="16" rx="1" />
                <rect x="14" y="4" width="7" height="16" rx="1" />
              </>
            )}
          </Frame>
        </PageTool>
      )}
      {controls.close && (
        <PageTool label={t("filePreview.close", { name })} onClick={controls.close}>
          <CloseIcon sx={icon} />
        </PageTool>
      )}
      {placement === "sidebar" && controls.hide && (
        <PageTool label={t("page.hideSidebar")} onClick={controls.hide}>
          <KeyboardArrowRightIcon sx={icon} />
        </PageTool>
      )}
    </>
  );
}
