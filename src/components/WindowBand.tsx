/**
 * The band along the top of the canvas, and the hairline a scan draws in it.
 *
 * Nothing is drawn where the title bar was and the graph runs underneath it,
 * but the band still picks the window up and still fills the screen on a double
 * click — the two things a title bar is for, kept without the bar.
 */

import { Box, LinearProgress } from "@mui/material";
import { HEADER_HEIGHT } from "./WindowControls";

export function WindowBand({ loading, stalled }: { loading: boolean; stalled: boolean }) {
  return (
    <>
      {/* Where the title bar was. Nothing is drawn there and the graph runs
            underneath it, but the band still picks the window up and still
            fills the screen on a double click — the two things a title bar is
            for, kept without the bar. This half only: the same band over the
            column is the sidebar's own header, which carries its two marks and
            picks the window up around them. */}
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
      {/* A scan that is still running, and a window that cannot get an
            answer at all. Both are one hairline along the top of the canvas —
            moving while it is working, red and still when it has stopped. The
            canvas underneath stays whatever it was, which is the rest of the
            answer: nothing has been drawn yet, or nothing new can be. */}
      {loading && (
        <LinearProgress
          sx={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, zIndex: 1200 }}
        />
      )}
      {!loading && stalled && (
        <Box
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            zIndex: 1200,
            bgcolor: "error.main",
          }}
        />
      )}
    </>
  );
}
