import { Button, Divider, Stack, Typography } from "@mui/material";

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
      <Typography variant="body2">{label}</Typography>
      {children}
    </Stack>
  );
}

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
