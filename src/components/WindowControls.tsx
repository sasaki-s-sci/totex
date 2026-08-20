import { Box, Stack } from "@mui/material";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useWindowFill } from "../hooks/useWindowFill";
import { CloseMark, MARK_BUTTON, MarkButton, MaximiseMark, MinimiseMark } from "./marks";

/**
 * What the title bar used to carry, without the title bar.
 *
 * The window is undecorated, so the frame the system would have drawn — a band
 * across the top holding a name nobody reads and three buttons — is gone, and
 * the graph has the whole of the window. What is left is the three moves
 * themselves, drawn as marks over the top right corner: transparent, faint, and
 * out of the way of what is under them.
 *
 * The cluster is also where the window is picked up, but the drag region is a
 * sheet *behind* the marks rather than a box around them: a press anywhere
 * inside an element carrying `data-tauri-drag-region` is taken as a press on
 * the window itself, so a button with that attribute over it is a button that
 * cannot be clicked. The row is see-through to the pointer and the marks are
 * not, which leaves the gaps between them dragging and the marks clicking.
 *
 * It is also held clear of the window's own edges. An undecorated window keeps
 * a few pixels of frame for resizing, and those pixels answer to the frame and
 * not to the page — a mark drawn into that band is a mark nothing can press.
 */
/**
 * How far in from the edges the marks start: clear of the resize frame.
 *
 * Read from the sidebar as well, whose own two marks stand in the same band at
 * the other end of it.
 */
export const HEADER_INSET = 8;

/**
 * The band along the top of the window that the marks stand in.
 *
 * Nothing draws it and nothing reserves it by itself — there is no title bar to
 * reserve it — but it is where the three marks are and where the window is
 * picked up, which makes it the one strip that belongs to the window rather than
 * to whatever is showing. A picture can run underneath it and lose nothing: the
 * graph does, and is read as a shape rather than line by line. Anything that
 * draws rows meant to be read keeps out, because a row with a button through it
 * is a row that cannot be read.
 */
export const HEADER_HEIGHT = HEADER_INSET + MARK_BUTTON;

export function WindowControls() {
  const { t } = useTranslation();
  const appWindow = useMemo(() => getCurrentWindow(), []);
  // Filling the screen is the one of the three that the system cannot be taken
  // at its word on; see the hook.
  const { filling, toggle } = useWindowFill();

  return (
    <Box sx={{ position: "absolute", top: HEADER_INSET, right: HEADER_INSET, zIndex: 1200 }}>
      {/* The sheet the window is picked up by, behind the marks and a little
          wider than they are, so the gaps around them drag it. */}
      <Box
        data-tauri-drag-region
        sx={{ position: "absolute", inset: -4, borderRadius: 1, zIndex: 0 }}
      />
      <Stack
        direction="row"
        spacing={0.25}
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
