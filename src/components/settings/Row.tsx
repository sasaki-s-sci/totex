/**
 * The lines of the page: a heading, a group under a heading, one setting, and
 * the one button this page has.
 */

import { Button, Divider, Stack, Typography } from "@mui/material";

/**
 * How tall a line of the page is at the least.
 *
 * A control's own height where there is one, and the name's where there is
 * not: the page is a column of short lines read top to bottom, and air between
 * them is height the page asks of the window for nothing.
 */
export const ROW_HEIGHT = 26;

/**
 * The shape a pull-down takes on this page: wide enough for the longest word
 * it offers, and no taller than the line it stands on. The engine's small
 * pull-down is still a line and a half tall; the padding is cut to the line.
 */
export const PICK_SX = { minWidth: 132, "& .MuiSelect-select": { py: 0.5 } } as const;

/** The shape a tick takes on this page: the box, and the least air round it
 *  that still leaves it aimable. */
export const TICK_SX = { p: 0.5 } as const;

/**
 * One line of the page: what the thing is on the left, what can be done about
 * it on the right.
 *
 * The rest of the window says everything with a mark, because everything else
 * in it stands in a row that is already being read — a folder, a branch, a
 * terminal — and a word beside the mark there would be a word in the way. This
 * page is the one place that is not true. It is gone looking for, it is read
 * once and left alone, and a mark that has to be hovered to find out what it
 * would do is a mark that is read twice. So here the thing is named, and the
 * mark is only kept where it says something a word cannot — see the ring on the
 * update button, which is how much of the download has arrived.
 *
 * The name is all there is on the left. What a setting does is said by the
 * heading it stands under and the name it has, and nothing else: a line of
 * small print under every row is a page twice as tall for the same ten
 * choices.
 */
export function Row({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <Stack
      direction="row"
      sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, minHeight: ROW_HEIGHT }}
    >
      <Typography variant="body2">{label}</Typography>
      {children}
    </Stack>
  );
}

/**
 * One part of the page: where the settings under it are felt.
 *
 * The page is cut by where a setting shows rather than by what kind of setting
 * it is — the canvas, a terminal, the agents' door — because that is what
 * somebody opening it is looking for: the thing in front of them that they want
 * to be different. A rule above and the name in the heavier weight, so that the
 * parts can be told apart from across the room.
 */
export function Section({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <>
      <Divider sx={{ my: 0.5 }} />
      <Typography
        variant="subtitle2"
        sx={{ minHeight: ROW_HEIGHT, display: "flex", alignItems: "center" }}
      >
        {name}
      </Typography>
      {children}
    </>
  );
}

/**
 * A few rows under one name inside a part: the page on the canvas, the graph
 * on it. Named in the small grey and stood in from the edge, so that the rows
 * read as belonging to the name and the name as belonging to the part.
 */
export function Group({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <>
      <Typography
        variant="caption"
        sx={{
          color: "text.secondary",
          minHeight: ROW_HEIGHT,
          display: "flex",
          alignItems: "center",
        }}
      >
        {name}
      </Typography>
      <Stack sx={{ gap: 0.5, pl: 1.5 }}>{children}</Stack>
    </>
  );
}

/**
 * The one button this page has, in the one shape it takes.
 *
 * Quiet: the window is a tool and nothing in it shouts, so a button that offers
 * something reads as the same grey the names beside it are set in, and answers
 * the pointer rather than the room. Red is kept for the one ending worth it — a
 * press that did not work — which is the same thing red says everywhere else in
 * the window.
 */
export function PageButton({
  danger,
  disabled,
  icon,
  onClick,
  children,
}: {
  /** Red at rest: for the press that failed, which is the one that says so. */
  danger?: boolean;
  disabled?: boolean;
  /** The one mark the page draws, where a word cannot say what it says. */
  icon?: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      size="small"
      variant="outlined"
      color={danger ? "error" : "inherit"}
      disabled={disabled}
      startIcon={icon}
      onClick={onClick}
      sx={{ flexShrink: 0, color: danger ? undefined : "text.secondary" }}
    >
      {children}
    </Button>
  );
}
