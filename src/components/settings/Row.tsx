/**
 * One line of the page: what the thing is on the left, what can be done about
 * it on the right, and the one button this page has.
 */

import { Button, Stack, Typography } from "@mui/material";

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
 * The name and the line under it are the left half whether or not there is a
 * line: a row with nothing to explain is a row with nothing under its name, and
 * it still sits at the same height as the rest.
 */
export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  /** The half-sentence a name cannot carry. Left out where the name is enough. */
  hint?: string;
  /**
   * What can be done about it, where that is one thing. A row that names what
   * the rows under it are about has nothing on its right, and still sits at the
   * same height as the rest.
   */
  children?: React.ReactNode;
}) {
  return (
    <Stack
      direction="row"
      sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, minHeight: 34 }}
    >
      <Stack sx={{ gap: 0.25 }}>
        <Typography variant="body2">{label}</Typography>
        {hint && (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {hint}
          </Typography>
        )}
      </Stack>
      {children}
    </Stack>
  );
}

/**
 * The one button this page has, in the one shape it takes.
 *
 * Quiet: the window is a tool and nothing in it shouts, so a button that offers
 * something reads as the same grey the names beside it are set in, and answers
 * the pointer rather than the room. Red is kept for the two endings — a restart
 * that takes every terminal with it, and a press that did not work — which is
 * the same thing red says everywhere else in the window.
 */
export function PageButton({
  danger,
  disabled,
  icon,
  onClick,
  children,
}: {
  /** Red at rest: for the press that ends something, and the one that failed. */
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
