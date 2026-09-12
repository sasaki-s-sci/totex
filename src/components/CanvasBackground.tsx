import { Background, BackgroundVariant } from "@xyflow/react";
import { useAppSettings } from "../lib/appSettings";
import { COMMIT_STEP } from "../lib/graph/grid";

/**
 * The lattice the graph stands on, drawn.
 *
 * A line per column and a line per row of the grid the layout keeps every mark
 * on — see `gridRows` and `gridMove` — so that a commit, a branch head and a
 * folder dropped into place all stand on a crossing rather than somewhere in a
 * cell. The columns are shifted by half a step because a mark stands in the
 * middle of its column and not on its left edge; the rows need no shift, a row
 * being the line itself.
 */
export function CanvasBackground() {
  const { backgroundGrid } = useAppSettings();
  if (!backgroundGrid) return null;

  return (
    <Background
      id="canvas-grid"
      variant={BackgroundVariant.Lines}
      gap={[COMMIT_STEP.x, COMMIT_STEP.y]}
      offset={[COMMIT_STEP.x / 2, 0]}
      lineWidth={0.5}
      color="var(--mui-palette-divider)"
    />
  );
}
