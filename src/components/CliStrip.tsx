import { Box } from "@mui/material";
import type { CliPlace } from "../lib/graphNav";

/** The hollow circle one terminal is drawn as. */
const MARK = 6;
/**
 * The room each of them takes.
 *
 * Wide enough for the number that stands in place of a circle, so that the run
 * does not shuffle as the panel moves from one terminal to the next. A number
 * past nine is wider than this and pushes what is to its right along; nothing
 * to its left moves, which is the half the eye is reading back from.
 */
const SLOT = 10;
/** Between two terminals standing on the same row of the canvas. */
const GAP = 4;
/**
 * And between two that are not: about two spaces' worth on top of the gap
 * above, which is what makes a run of eight read as three places rather than as
 * eight of one thing.
 */
const GROUP_GAP = GAP + 9;

type Props = {
  /** Every terminal on the canvas, in the order the numbers are given out. */
  run: readonly CliPlace[];
  /** The one the panel is showing, which is the only one drawn as a number. */
  showing: string | null;
};

/**
 * Where the terminal being read stands among all of them.
 *
 * The panel has no chrome and wants none: what is in it says which session this
 * is. What it cannot say is which of a window's terminals that is — a stack on
 * the canvas is one glyph drawn over and over, and the panel is the one place
 * somebody is looking at when they want to know where they are.
 *
 * So this is a place-marker and nothing more. Every terminal is a hollow circle
 * in the order the numbers are given out — down the canvas, left to right — and
 * the one being shown is its own number, in the canvas's one light. The number
 * replaces the circle rather than sitting beside it, exactly as it does on the
 * mark itself while Ctrl is held: it is the same number, and pressing Ctrl with
 * it is what goes back to this terminal from anywhere.
 *
 * Read left to right from the panel's own edge, and broken by a wider gap
 * wherever the next terminal is standing on a different row of the canvas — a
 * second repository, or a folder. Nothing here is pressable: the marks on the
 * canvas are what answer to a press, and a second set of them in the band would
 * be a row of buttons over the strip the window is picked up by.
 *
 * One terminal draws nothing at all. There is no position to find among one,
 * the same reason a directory's only session is given no ordinal.
 */
export function CliStrip({ run, showing }: Props) {
  if (run.length < 2) return null;

  return (
    <Box
      aria-hidden="true"
      sx={{
        display: "flex",
        alignItems: "center",
        // The band is the window's, so the strip is see-through to the pointer:
        // the sheet behind it is what the window is dragged by.
        pointerEvents: "none",
      }}
    >
      {run.map((place, at) => {
        const lit = place.session === showing;
        return (
          <Box
            key={place.session}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              minWidth: `${SLOT}px`,
              height: `${SLOT}px`,
              ml: at === 0 ? 0 : `${run[at - 1]?.group === place.group ? GAP : GROUP_GAP}px`,
            }}
          >
            {lit ? (
              <Box
                component="span"
                sx={{
                  fontSize: 9,
                  fontWeight: 600,
                  // So that 1 and 11 stand in the same place, as on the mark.
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                  letterSpacing: "-0.02em",
                  color: "primary.main",
                }}
              >
                {at + 1}
              </Box>
            ) : (
              <Box
                sx={{
                  width: `${MARK}px`,
                  height: `${MARK}px`,
                  borderRadius: "50%",
                  border: 1,
                  borderColor: "text.disabled",
                }}
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}
