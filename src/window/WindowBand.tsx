/**
 * The title bar's two jobs without the bar: picks the window up, fills the screen on double click.
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
        opacity: 0,
        bgcolor: "action.hover",
        transition: "opacity 120ms ease-out",
        "&:hover": { opacity: 1 },
      }}
    />
  );
}
