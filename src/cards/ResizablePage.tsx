import { Box } from "@mui/material";
import { type ReactNode, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useFrontState } from "../shell/state";

export function ResizablePage({
  id,
  initialHeight,
  minHeight,
  children,
  compact = false,
  onExpand,
  onCompact,
}: {
  id: string;
  initialHeight: number;
  minHeight: number;
  children: ReactNode;
  compact?: boolean;
  onExpand?: () => void;
  onCompact?: () => void;
}) {
  const { t } = useTranslation();
  const [height, setHeight] = useFrontState(
    `cards.height.${id}`,
    Math.max(minHeight, initialHeight),
  );
  const drag = useRef<{ pointer: number; y: number; height: number; compact: boolean } | null>(
    null,
  );
  return (
    <Box
      className="resizable-page"
      sx={{
        position: "relative",
        height: compact ? "var(--compact-height, 64px)" : height,
        minWidth: 0,
        flexShrink: 0,
      }}
    >
      {children}
      <Box
        role="separator"
        tabIndex={0}
        aria-label={t("page.resizeHeight")}
        aria-orientation="horizontal"
        aria-valuemin={onCompact ? 0 : minHeight}
        aria-valuenow={compact ? 0 : height}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.stopPropagation();
          drag.current = {
            pointer: event.pointerId,
            y: event.clientY,
            height: event.currentTarget.parentElement?.getBoundingClientRect().height ?? height,
            compact,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const held = drag.current;
          if (held?.pointer !== event.pointerId) return;
          const next = held.height + event.clientY - held.y;
          if (next <= 64 && onCompact) {
            if (!held.compact) onCompact();
            held.compact = true;
          } else if (next > 64 || !onCompact) {
            if (held.compact) onExpand?.();
            held.compact = false;
            setHeight(Math.max(minHeight, next));
          }
        }}
        onPointerUp={(event) => {
          if (drag.current?.pointer !== event.pointerId) return;
          drag.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          event.stopPropagation();
          if (compact) {
            if (event.key === "ArrowDown") {
              setHeight(minHeight);
              onExpand?.();
            }
            return;
          }
          if (event.key === "ArrowUp" && height <= minHeight && onCompact) {
            onCompact();
            return;
          }
          setHeight((held) => Math.max(minHeight, held + (event.key === "ArrowUp" ? -16 : 16)));
        }}
        sx={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: -3,
          height: 8,
          cursor: "row-resize",
          touchAction: "none",
          zIndex: 3,
          "&:hover, &:focus-visible": { backgroundColor: "action.hover" },
        }}
      />
    </Box>
  );
}
