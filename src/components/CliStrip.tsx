import { Box, Typography } from "@mui/material";
import type { Doing } from "../lib/doing";
import type { CliPlace } from "../lib/graphNav";
import { CLI_GLYPH, CliGlyph } from "./marks";

/** Between two terminals standing on the same row of the canvas. */
const GAP = 4;
/**
 * How far a place stands off the rule that divides it from the one before.
 *
 * The gap either side of the line, rather than the whole of what is between two
 * runs: the rule is what says they are two places now, and the air is only what
 * keeps it off the marks.
 */
const GROUP_GAP = 6;
/**
 * The line the names are set on, over the runs they head.
 *
 * The band is what it was — the window's own, and the same height at both ends
 * of it — so the name and the marks share it rather than the strip growing into
 * the panel: a line of a name and a line of marks, which is what the 24 pixels
 * under the inset hold.
 */
const NAME_LINE = 12;

type Props = {
  /** Every terminal on the canvas, in the order the numbers are given out. */
  run: readonly CliPlace[];
  /** The one the panel is showing, which is the only one drawn as a number. */
  showing: string | null;
  /** What each of them is doing, which is what its glyph draws. */
  doings: ReadonlyMap<string, Doing>;
};

/** One place in the strip: what it is called, and the terminals standing in it
 *  with the numbers that reach them. */
type Party = {
  group: string;
  name: string;
  run: { place: CliPlace; jump: number }[];
  /** The first terminal in it, which is what the place is drawn under: a row
   *  the run comes back to further down is a second place, and the sessions are
   *  what tell the two apart. */
  key: string;
};

/** How wide one place's own marks are, which is as narrow as it will go. */
function marksWide(party: Party): number {
  return party.run.length * CLI_GLYPH + (party.run.length - 1) * GAP;
}

/**
 * The run broken into the places it was read from.
 *
 * Consecutive rather than gathered: the run is the canvas read down the page,
 * and a place is however much of it is standing in one row. Gathering by row
 * would put the numbers out of order, and the numbers are the whole point of
 * the strip.
 */
function parties(run: readonly CliPlace[]): Party[] {
  const places: Party[] = [];
  for (const [at, place] of run.entries()) {
    const last = places.at(-1);
    // The number that reaches this terminal is where it stands in the whole
    // run, not where it stands in its own place.
    const held = { place, jump: at + 1 };
    if (last && last.group === place.group) last.run.push(held);
    else places.push({ group: place.group, name: place.name, run: [held], key: place.session });
  }
  return places;
}

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
 * Read left to right from the panel's own edge, and cut by a rule wherever the
 * next terminal is standing on a different row of the canvas — a second
 * repository, or a folder. Each of those runs is headed by that row's own name,
 * which is what the strip could not say before: eight marks in a row said how
 * many terminals there were and how far along this one was, and left where any
 * of them was running to be found by going back to the graph. The rule and the
 * name do one thing between them, which is why the wider gap that used to
 * stand for the break is gone — a run under its own name is already separate,
 * and air as well as a line would be the same break drawn twice.
 *
 * Nothing here is pressable: the marks on the canvas are what answer to a
 * press, and a second set of them in the band would be a row of buttons over
 * the strip the window is picked up by.
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
        // Every place is the height of the tallest, which is what lets the rule
        // between two of them run the whole way down the strip.
        alignItems: "stretch",
        // What the band leaves it, and never more: the panel holds the room the
        // window's own marks stand in, and the names give way rather than
        // running into them. See the `pr` on the band in `SidePanel`.
        flex: 1,
        minWidth: 0,
        // The band is the window's, so the strip is see-through to the pointer:
        // the sheet behind it is what the window is dragged by.
        pointerEvents: "none",
      }}
    >
      {parties(run).map((party, at) => (
        <Box
          key={party.key}
          sx={{
            display: "flex",
            flexDirection: "column",
            // Down to its own marks and no further. A strip too wide for the
            // band gives its room back out of the names, which are the part of
            // it that can be cut and still say something — a run of marks with
            // one of them shaved off is a run nobody can count.
            minWidth: `${marksWide(party)}px`,
            // The rule between this place and the one before it, and the air
            // that keeps it off both runs of marks.
            ...(at === 0
              ? null
              : {
                  ml: `${GROUP_GAP}px`,
                  pl: `${GROUP_GAP}px`,
                  borderLeft: 1,
                  borderColor: "divider",
                }),
          }}
        >
          {/* The row the run is standing on, said in the words the canvas says
              it in. Quieter than the marks under it: it is what they are
              standing in rather than one more thing in the run, and a name at
              the weight of the terminal it heads would be read first. */}
          <Typography
            noWrap
            sx={{
              fontSize: 10,
              lineHeight: `${NAME_LINE}px`,
              color: "text.disabled",
            }}
          >
            {party.name}
          </Typography>

          <Box sx={{ display: "flex", alignItems: "center" }}>
            {party.run.map(({ place, jump }, slot) => {
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
                    flex: "none",
                    // The ink the glyph is handed, which is the whole of what
                    // says which of these the panel is holding — the same grey
                    // the marks on the canvas are drawn in, and the same light
                    // on the one that is open.
                    color: lit ? "primary.main" : "text.disabled",
                    ml: slot === 0 ? 0 : `${GAP}px`,
                  }}
                >
                  <CliGlyph doing={doings.get(place.session) ?? null} jump={lit ? jump : null} />
                </Box>
              );
            })}
          </Box>
        </Box>
      ))}
    </Box>
  );
}
