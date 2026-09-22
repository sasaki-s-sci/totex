import CloseIcon from "@mui/icons-material/Close";
import CloseFullscreenIcon from "@mui/icons-material/CloseFullscreen";
import HeightIcon from "@mui/icons-material/Height";
import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PushPinIcon from "@mui/icons-material/PushPin";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PageTool } from "./Page";
import type { PagePlacement } from "./placement";

export type PageControls = {
  move?: () => void;
  pin?: () => void;
  fit?: () => void;
  collapse?: () => void;
  shrink?: () => void;
  close?: () => void;
  hide?: () => void;
};

/** A capability is a real action, never a placeholder that silently does nothing. */
export function PageTools({
  name,
  placement,
  controls,
  collapsed = false,
  pinned = false,
  children,
}: {
  name: string;
  placement: PagePlacement;
  controls: PageControls;
  collapsed?: boolean;
  pinned?: boolean;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const icon = { fontSize: 12 };
  return (
    <>
      {children}
      {controls.move && (
        <PageTool
          label={t(placement === "canvas" ? "page.toSidebar" : "page.toCanvas", { name })}
          onClick={controls.move}
        >
          {placement === "canvas" ? (
            <ViewSidebarOutlinedIcon sx={icon} />
          ) : (
            <OpenInNewIcon sx={icon} />
          )}
        </PageTool>
      )}
      {placement === "canvas" && (
        <>
          {controls.pin && (
            <PageTool
              label={t(pinned ? "filePreview.unpin" : "filePreview.pin", { name })}
              onClick={controls.pin}
            >
              {pinned ? <PushPinIcon sx={icon} /> : <PushPinOutlinedIcon sx={icon} />}
            </PageTool>
          )}
          {controls.fit && (
            <PageTool label={t("filePreview.fitWidth", { name })} onClick={controls.fit}>
              <HeightIcon sx={{ ...icon, transform: "rotate(90deg)" }} />
            </PageTool>
          )}
          {controls.collapse && (
            <PageTool
              label={t(collapsed ? "filePreview.expand" : "filePreview.collapse", { name })}
              onClick={controls.collapse}
            >
              {collapsed ? <KeyboardArrowDownIcon sx={icon} /> : <KeyboardArrowUpIcon sx={icon} />}
            </PageTool>
          )}
          {controls.shrink && (
            <PageTool label={t("filePreview.shrink", { name })} onClick={controls.shrink}>
              <CloseFullscreenIcon sx={icon} />
            </PageTool>
          )}
        </>
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
