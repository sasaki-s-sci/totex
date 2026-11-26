import { Box } from "@mui/material";
import { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Frame, MarkButton } from "../marks";
import { HEADER_INSET, HEADER_MARKS } from "../window/WindowControls";

function layer() {
  return document.querySelector<HTMLDialogElement>(".canvas-expanded[open]") ?? document.body;
}

/** Expanded resources occupy the top layer, above every ordinary z-index. */
export function SidebarReopen({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  const [container, setContainer] = useState(layer);
  useLayoutEffect(() => {
    const observer = new MutationObserver(() => setContainer(layer()));
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => observer.disconnect();
  }, []);
  return createPortal(
    <Box
      data-sidebar-reopen="right"
      sx={{
        position: "fixed",
        top: HEADER_INSET,
        right: HEADER_MARKS + HEADER_INSET,
        zIndex: 1200,
        bgcolor: "background.default",
        borderRadius: 1,
      }}
    >
      <MarkButton
        label={t("page.openSidebar")}
        aria-expanded={false}
        aria-controls="cli-sidebar"
        onClick={() => {
          if (container instanceof HTMLDialogElement && container.open) container.close();
          onClick();
        }}
      >
        <Frame>
          <path d="M15 6 9 12 15 18" />
        </Frame>
      </MarkButton>
    </Box>,
    container,
  );
}
