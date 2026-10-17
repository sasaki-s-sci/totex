import KeyboardArrowDownIcon from "@mui/icons-material/KeyboardArrowDown";
import KeyboardArrowUpIcon from "@mui/icons-material/KeyboardArrowUp";
import { Button, ButtonBase, Divider, Stack, Typography } from "@mui/material";
import { useState } from "react";

export const ROW_HEIGHT = 26;

/** MUI's small pull-down is still a line and a half tall; the padding cuts it to the row. */
export const PICK_SX = { minWidth: 132, "& .MuiSelect-select": { py: 0.5 } } as const;

export const TICK_SX = { p: 0.5 } as const;

export function Row({ label, children }: { label: string; children?: React.ReactNode }) {
  return (
    <Stack
      direction="row"
      sx={{ alignItems: "center", justifyContent: "space-between", gap: 2, minHeight: ROW_HEIGHT }}
    >
      {/* A narrow column squeezes the control first, so a short label stays on one line. */}
      <Typography variant="body2" sx={{ minWidth: "5em" }}>
        {label}
      </Typography>
      {children}
    </Stack>
  );
}

/** Nested rows hang off a rule so each level reads as belonging to the heading above it. */
export const NEST_SX = {
  gap: 0.5,
  ml: 0.75,
  pl: 1.5,
  borderLeft: 1,
  borderColor: "divider",
} as const;

/** A top-level heading that folds its rows away; folded rows unmount, so their callouts leave the miniature. */
export function Section({ name, children }: { name: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Divider sx={{ my: 0.5 }} />
      <ButtonBase
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        sx={{
          minHeight: ROW_HEIGHT,
          justifyContent: "flex-start",
          gap: 0.5,
          borderRadius: 1,
          textAlign: "left",
        }}
      >
        <Typography component="span" variant="subtitle2" sx={{ fontWeight: 600 }}>
          {name}
        </Typography>
        {open ? (
          <KeyboardArrowUpIcon aria-hidden="true" sx={{ fontSize: 16, color: "text.secondary" }} />
        ) : (
          <KeyboardArrowDownIcon
            aria-hidden="true"
            sx={{ fontSize: 16, color: "text.secondary" }}
          />
        )}
      </ButtonBase>
      {open && <Stack sx={NEST_SX}>{children}</Stack>}
    </>
  );
}

export function Group({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <Stack sx={{ gap: 0.5, mt: 0.5 }}>
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          fontWeight: 600,
          minHeight: ROW_HEIGHT,
          display: "flex",
          alignItems: "center",
        }}
      >
        {name}
      </Typography>
      <Stack sx={NEST_SX}>{children}</Stack>
    </Stack>
  );
}

export function PageButton({
  title,
  danger,
  disabled,
  icon,
  onClick,
  children,
}: {
  title?: string;
  danger?: boolean;
  disabled?: boolean;
  icon?: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      title={title}
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
