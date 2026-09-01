import { Box, Paper } from "@mui/material";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import type { CliPlace } from "../lib/graphNav";
import type { Session } from "../lib/session";
import { CliStrip } from "./CliStrip";
import { CliView } from "./CliView";
import { ResizeGrip, useResizeGrip } from "./useResizeGrip";
import { HEADER_HEIGHT, HEADER_INSET } from "./WindowControls";

const MIN_WIDTH = 320;
const MAX_WIDTH = 1100;
const DEFAULT_WIDTH = 460;
/**
 * The panel is unmounted whenever nothing is open, so the width has to live
 * somewhere that outlasts it — otherwise every session after the first would
 * open at the default and have to be dragged out again.
 */
const WIDTH_KEY = "totex.panel.width";

type Props = {
  /** Everything that is running, in the order it was opened. */
  sessions: readonly Session[];
  /** Which one is being looked at, or null when the panel is put away. */
  showing: string | null;
  /**
   * Every terminal on the canvas, in the order the numbers are given out.
   *
   * Read off what is drawn rather than out of the sessions above: the numbers
   * are the canvas's, and the strip in the band is that same reading. See
   * `cliRun`.
   */
  run: readonly CliPlace[];
  /** The process finished by itself, so there is no session left to show. */
  onEnded: (session: Session) => void;
};

/**
 * What is being looked at, beside the graph.
 *
 * No chrome at all: no header, no tab strip, no path, no close. What is in it
 * is what says which session this is, and pressing that session's mark on the
 * graph again is what puts the panel away — so a bar here would only be naming
 * what is already open, out of rows the terminal wants.
 *
 * Every session is mounted for as long as it is running, and all but one are
 * hidden — hidden while still laid out, which is what makes moving between them
 * cost a property rather than a redraw. See below.
 */
export function SidePanel({ sessions, showing, run, onEnded }: Props) {
  const { t } = useTranslation();
  const panel = useRef<HTMLDivElement>(null);
  // The grip is on the panel's left edge, so dragging left widens it.
  const { width, grip } = useResizeGrip({
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    initial: DEFAULT_WIDTH,
    side: "start",
    storageKey: WIDTH_KEY,
    element: panel,
  });

  const open = sessions.find((session) => session.id === showing) ?? null;

  return (
    <Paper
      component="aside"
      square
      elevation={0}
      ref={panel}
      sx={{
        position: "relative",
        width,
        flex: "none",
        // Put away rather than taken down: the sessions inside carry on, and a
        // terminal that is unmounted comes back empty.
        display: open ? "flex" : "none",
        flexDirection: "column",
        borderLeft: 1,
        borderColor: "divider",
      }}
    >
      {/* The grip between the graph and the panel. */}
      <ResizeGrip label={t("resize.width")} {...grip} />

      {/* The window's band, carried on across the panel. The panel sits under
          the corner the marks are drawn into, and a terminal row under the
          close mark is a row with a button through it — so the rows start
          below the band instead of running into it. Nothing is drawn in it but
          the run of marks at the near edge — no plate and no rule under them —
          which leaves the panel looking as though it begins at the top of the
          window and reads as one band the whole way across. */}
      <Box sx={{ position: "relative", flex: "none", height: HEADER_HEIGHT }}>
        <Box
          data-tauri-drag-region
          sx={{
            position: "absolute",
            inset: 0,
            cursor: "grab",
            // Invisible at rest, and a wash under the pointer — the same as the
            // band over the graph, because it is the same band.
            opacity: 0,
            bgcolor: "action.hover",
            transition: "opacity 120ms ease-out",
            "&:hover": { opacity: 1 },
          }}
        />

        {/* Where the terminal in the panel stands among all of them, at the
            near edge of the band and clear of the grip. Drawn over the sheet
            rather than inside it: the sheet is invisible until the pointer is
            on it, and the strip is there to be read the whole time. Its own
            marks line up with the window's, which sit on the band's floor at
            the other end of the same row. */}
        <Box
          sx={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            height: "100%",
            pt: `${HEADER_INSET}px`,
            pl: `${HEADER_INSET}px`,
          }}
        >
          <CliStrip run={run} showing={showing} />
        </Box>
      </Box>

      {/* The sessions, one on top of another and every one of them the size of
          the panel. Hidden with `visibility` rather than by being given no box
          at all: a terminal with no box is one xterm stops drawing, and it
          comes back needing every row on the screen redrawn — a frame or two
          after the panel has already changed, which is what moving between two
          terminals used to cost. Left laid out, what is underneath was drawn
          all along and the move is one property on one element.

          Stacked rather than in a column for the same reason: all of them keep
          the panel's size, so nothing is measured, refitted or told a new size
          when the one on top changes. */}
      <Box sx={{ position: "relative", flex: 1, minHeight: 0 }}>
        {sessions.map((session) => (
          <Box
            key={session.id}
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              visibility: session.id === showing ? "visible" : "hidden",
            }}
          >
            <CliView
              session={session}
              shown={session.id === showing}
              onEnded={() => onEnded(session)}
            />
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
