import { Box, CircularProgress, Divider, Stack } from "@mui/material";

export function Palette({ children }: { children: React.ReactNode }) {
  return (
    <Stack direction="row" spacing={0.25} sx={{ p: 0.75, alignItems: "center" }}>
      {children}
    </Stack>
  );
}

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
  label: string;
  disabled?: boolean;
  busy?: boolean;
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
        "&:disabled": { opacity: 0.3, cursor: "default", bgcolor: "transparent" },
      }}
    >
      {busy ? <CircularProgress size={14} color="inherit" /> : children}
    </Box>
  );
}
