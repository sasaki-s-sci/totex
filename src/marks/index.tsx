import { Box } from "@mui/material";

// Own paths at stated pixel sizes: an em-sized icon once rendered with no size at all in WebKit.
export const SIZE = 15;

export const ROW_SIZE = 20;

export const MARK_BUTTON = 24;

// One screen pixel at every size: a stroke stated in viewBox units would scale with the mark.
export const HAIRLINE = 1;

export function struck(size: number, weight: number = HAIRLINE): number {
  return (weight * 24) / size;
}

export function Frame({
  size = SIZE,
  spill,
  children,
}: {
  size?: number;
  /** Let figures overflow the square instead of being clipped. */
  spill?: boolean;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={struck(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      // A style, not an attribute: only a style outranks the engine's overflow rule on the outermost svg.
      style={spill ? { overflow: "visible" } : undefined}
    >
      {children}
    </svg>
  );
}

export function MarkButton({
  label,
  danger,
  faint,
  onClick,
  children,
  ...aria
}: {
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  label: string;
  danger?: boolean;
  faint?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      {...aria}
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: MARK_BUTTON,
        height: MARK_BUTTON,
        p: 0,
        border: "none",
        borderRadius: 1,
        background: "none",
        color: "text.secondary",
        cursor: "pointer",
        opacity: faint ? 0.45 : 1,
        transition: "opacity 90ms ease-out, color 90ms ease-out",
        "&:hover, &:focus-visible": {
          opacity: 1,
          color: danger ? "error.main" : "text.primary",
        },
      }}
    >
      {children}
    </Box>
  );
}

export * from "./cli";
export * from "./row";
export * from "./tree";
export * from "./window";
