import { Box, Typography } from "@mui/material";
import type { Doing } from "../lib/doing";
import type { CliPlace } from "../lib/graphNav";
import type { Session } from "../lib/session";
import { CLI_GLYPH, CliGlyph } from "../marks";

const GAP = 4;
const GROUP_GAP = 6;
// A name line over a mark line is what the band holds under the inset.
const NAME_LINE = 12;

type Props = {
  run: readonly CliPlace[];
  sessions: readonly Session[];
  showing: string | null;
  doings: ReadonlyMap<string, Doing>;
};

type Party = {
  group: string;
  name: string;
  run: { place: CliPlace; jump: number | null }[];
  /** The first session: a row the run returns to further down is a second place. */
  key: string;
};

function marksWide(party: Party): number {
  return party.run.length * CLI_GLYPH + (party.run.length - 1) * GAP;
}

// Consecutive, not grouped by row: grouping would put the numbers out of order.
function parties(run: readonly CliPlace[]): Party[] {
  const places: Party[] = [];
  for (const [at, place] of run.entries()) {
    const last = places.at(-1);
    const held = { place, jump: at + 1 };
    if (last && last.group === place.group) last.run.push(held);
    else places.push({ group: place.group, name: place.name, run: [held], key: place.session });
  }
  return places;
}

export function TabStrip({ run, sessions, showing, doings }: Props) {
  const groups = parties(run);
  // Sessions outside the current graph still belong in the header, without a graph shortcut.
  for (const session of sessions) {
    if (run.some((place) => place.session === session.id)) continue;
    const place = { session: session.id, group: session.cwd, name: session.branch };
    groups.push({
      group: place.group,
      name: place.name,
      key: session.id,
      run: [{ place, jump: null }],
    });
  }
  return (
    <Box
      className="page__terminal-list"
      aria-hidden="true"
      sx={{
        display: "flex",
        alignItems: "stretch",
        flex: 1,
        minWidth: 0,
        overflowX: "auto",
        scrollbarWidth: "none",
      }}
    >
      {groups.map((party, at) => (
        <Box
          key={party.key}
          sx={{
            display: "flex",
            flexDirection: "column",
            // Names give way before marks: a run with a mark cut off cannot be counted.
            minWidth: `${marksWide(party)}px`,
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
