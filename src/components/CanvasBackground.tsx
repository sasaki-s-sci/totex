import { Background, BackgroundVariant } from "@xyflow/react";
import { useAppSettings } from "../lib/appSettings";

export function CanvasBackground() {
  const { backgroundGrid } = useAppSettings();
  if (!backgroundGrid) return null;

  return (
    <Background
      id="canvas-grid"
      variant={BackgroundVariant.Lines}
      gap={24}
      lineWidth={0.5}
      color="var(--mui-palette-divider)"
    />
  );
}
