import { Background, BackgroundVariant } from "@xyflow/react";
import { useAppSettings } from "../lib/appSettings";

export function CanvasBackground() {
  const { backgroundGrid, gridStep } = useAppSettings();
  if (!backgroundGrid) return null;

  return (
    <Background
      id="canvas-grid"
      variant={BackgroundVariant.Lines}
      gap={gridStep}
      lineWidth={0.5}
      color="var(--mui-palette-divider)"
    />
  );
}
