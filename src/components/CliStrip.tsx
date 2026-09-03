import { Box } from "@mui/material";
import type { Doing } from "../lib/doing";
import type { CliPlace } from "../lib/graphNav";
import { CLI_GLYPH, CliGlyph } from "./marks";

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
  /** What each of them is doing, which is what its glyph draws. */
  doings: ReadonlyMap<string, Doing>;
};

/**
 * Where the terminal being read stands among all of them.
 *
 * The panel has no chrome and wants none: what is in it says which session this
 * is. What it cannot say is which of a window's terminals that is — a stack on
 * the canvas is one glyph drawn over and over, and the panel is the one place
 * somebody is looking at when they want to know where they are.
 *
 * So this is the canvas's own run of terminals, said again in the band: the
 * same marks, at the same size, saying the same three things about each of them
 * — an agent, something running, or a shell at its prompt. It is one reading of
 * one set of sessions drawn in two places, so it is one drawing; see `CliGlyph`,
 * which is that drawing. A row of shapes of its own here would be a second
 * alphabet for the same terminals, learnt in the band and unlearnt on the
 * canvas.
 *
 * The one being shown is its own number, in the canvas's one light. The number
 * replaces the glyph rather than sitting beside it, exactly as it does on the
 * mark itself while Ctrl is held: it is the same number, and pressing Ctrl with
 * it is what goes back to this terminal from anywhere. It is struck inside the
 * mark's own square, so a second figure does not push the run along and nothing
 * to either side of it moves.
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
export function CliStrip({ run, showing, doings }: Props) {
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
              width: `${CLI_GLYPH}px`,
              height: `${CLI_GLYPH}px`,
              // The ink the glyph is handed, which is the whole of what says
              // which of these the panel is holding — the same grey the marks
              // on the canvas are drawn in, and the same light on the one that
              // is open.
              color: lit ? "primary.main" : "text.disabled",
              ml: at === 0 ? 0 : `${run[at - 1]?.group === place.group ? GAP : GROUP_GAP}px`,
            }}
          >
            <CliGlyph doing={doings.get(place.session) ?? null} jump={lit ? at + 1 : null} />
          </Box>
        );
      })}
    </Box>
  );
}
