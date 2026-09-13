import { Box, type BoxProps } from "@mui/material";
import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";
import { HEADER_HEIGHT } from "../window/WindowControls";
import { ResizeGrip, useResizeGrip } from "./useResizeGrip";

export type Sizing = { min: number; max: number; initial: number; storageKey: string };

type Props = Omit<BoxProps, "children"> & {
  side: "left" | "right";
  open: boolean;
  sizing: Sizing;
  band: ReactNode;
  children: ReactNode;
};

/** Put away with `display: none` rather than unmounted, so what is inside keeps its state. */
export function Sidebar({ side, open, sizing, band, children, sx, ...box }: Props) {
  const { t } = useTranslation();
  const element = useRef<HTMLDivElement>(null);
  const { width, grip } = useResizeGrip({
    ...sizing,
    side: side === "left" ? "end" : "start",
    element,
  });

  return (
    <Box
      ref={element}
      {...box}
      sx={{
        position: "relative",
        width,
        flex: "none",
        display: open ? "flex" : "none",
        flexDirection: "column",
        bgcolor: "background.paper",
        ...(side === "left" ? { borderRight: 1 } : { borderLeft: 1 }),
        borderColor: "divider",
        ...sx,
      }}
    >
      <ResizeGrip label={t("resize.width")} {...grip} />
      <Box sx={{ position: "relative", flex: "none", height: HEADER_HEIGHT }}>
        {/* A press inside a drag region is a press on the window, so the sheet sits behind the
            marks, not around them. */}
        <Box
          data-tauri-drag-region
          sx={{
            position: "absolute",
            inset: 0,
            cursor: "grab",
            opacity: 0,
            bgcolor: "action.hover",
            transition: "opacity 120ms ease-out",
            "&:hover": { opacity: 1 },
          }}
        />
        {band}
      </Box>
      {children}
    </Box>
  );
}
