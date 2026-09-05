/**
 * The invisible drag region along the top of the canvas.
 *
 * Nothing is drawn where the title bar was and the graph runs underneath it,
 * but the band still picks the window up and still fills the screen on a double
 * click — the two things a title bar is for, kept without the bar.
 */

import { Box } from "@mui/material";
import { HEADER_HEIGHT } from "./WindowControls";

export function WindowBand() {
  return (
    <Box
      data-tauri-drag-region
      sx={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: HEADER_HEIGHT,
        zIndex: 1100,
        cursor: "grab",
        // Nothing at all until the pointer is on it, and then barely
        // anything: a band that is drawn all the time is a title bar, which
        // is the row this window went without. The wash is the whole of
        // what it says — the shape of the band is the message, and a mark
        // drawn inside it would be a second one saying the same thing.
        opacity: 0,
        bgcolor: "action.hover",
        transition: "opacity 120ms ease-out",
        "&:hover": { opacity: 1 },
      }}
    />
  );
}
