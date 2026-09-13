import { Box, Stack } from "@mui/material";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { CloseMark, MARK_BUTTON, MarkButton, MaximiseMark, MinimiseMark } from "../marks";
import { useWindowFill } from "./useWindowFill";

// The drag region is a sheet behind the marks: a press inside `data-tauri-drag-region` is a press
// on the window, so a button under one cannot be clicked.
/** Clear of the resize frame an undecorated window keeps at its edges. */
export const HEADER_INSET = 8;

/** The one strip that belongs to the window; rows meant to be read keep out of it. */
export const HEADER_HEIGHT = HEADER_INSET + MARK_BUTTON;

const MARK_GAP = 2;

/** Read by the right sidebar, whose band ends where these marks begin. */
export const HEADER_MARKS = MARK_BUTTON * 3 + MARK_GAP * 2 + HEADER_INSET;

export function WindowControls() {
  const { t } = useTranslation();
  const appWindow = useMemo(() => getCurrentWindow(), []);
  // Maximise cannot be taken at the system's word; see the hook.
  const { filling, toggle } = useWindowFill();

  return (
    <Box sx={{ position: "absolute", top: HEADER_INSET, right: HEADER_INSET, zIndex: 1200 }}>
      <Box
        data-tauri-drag-region
        sx={{ position: "absolute", inset: -4, borderRadius: 1, zIndex: 0 }}
      />
      <Stack
        direction="row"
        spacing={`${MARK_GAP}px`}
        sx={{
          position: "relative",
          zIndex: 1,
          alignItems: "center",
          // See-through in the gaps, so the sheet behind gets those presses.
          pointerEvents: "none",
          "& > *": { pointerEvents: "auto" },
        }}
      >
        <MarkButton
          label={t("window.minimise")}
          faint
          onClick={() => void appWindow.minimize().catch(() => undefined)}
        >
          <MinimiseMark />
        </MarkButton>
        <MarkButton
          label={filling ? t("window.restore") : t("window.maximise")}
          faint
          onClick={() => void toggle()}
        >
          <MaximiseMark on={filling} />
        </MarkButton>
        <MarkButton
          label={t("window.close")}
          danger
          faint
          onClick={() => void appWindow.close().catch(() => undefined)}
        >
          <CloseMark />
        </MarkButton>
      </Stack>
    </Box>
  );
}
