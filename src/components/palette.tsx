import { Box, CircularProgress, Divider, Stack } from "@mui/material";

/**
 * A menu with no words in it: one mark per thing that can be done, in a row.
 *
 * The graph's menus used to be lists, and a list of things to do is a list of
 * sentences — each row said what it would do, what it would do it to, and why
 * it could not. None of that is drawn now, so the shape had to change with it:
 * a row of marks is read at a glance and is the same size whatever it holds.
 *
 * What is left to say is said by the marks themselves. A mark that is faded is
 * one that cannot be pressed — the window works out beforehand what git would
 * refuse and simply does not offer it. A mark that was refused after all is
 * red. A mark that is working spins in its own place. Nothing here is armed:
 * the one press that ends something puts its question in words instead.
 */
export function Palette({ children }: { children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={0.25} sx={{ p: 0.75, alignItems: "center" }}>
      {children}
    </Stack>
  );
}

/** Between the things that only add and the things that rewrite. */
export function PaletteDivider() {
  return <Divider orientation="vertical" flexItem sx={{ mx: 0.5, my: 0.5 }} />;
}

export function PaletteButton({
  label,
  disabled,
  busy,
  failed,
  onClick,
  children,
}: {
  /** What the mark is, for something reading the window aloud. Never drawn. */
  label: string;
  disabled?: boolean;
  busy?: boolean;
  /** Refused by git after it was pressed — the only failure left to show. */
  failed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      disabled={disabled || busy}
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 30,
        p: 0,
        border: "none",
        borderRadius: 1,
        background: "none",
        color: failed ? "error.main" : "text.secondary",
        cursor: "pointer",
        transition: "background-color 90ms ease-out, color 90ms ease-out",
        "&:hover, &:focus-visible": {
          bgcolor: "action.hover",
          color: failed ? "error.main" : "text.primary",
        },
        // Not offered rather than offered and refused: this is where every
        // sentence about why something could not be done used to go.
        "&:disabled": { opacity: 0.3, cursor: "default", bgcolor: "transparent" },
      }}
    >
      {busy ? <CircularProgress size={14} color="inherit" /> : children}
    </Box>
  );
}
