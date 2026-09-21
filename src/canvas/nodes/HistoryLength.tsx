import { Checkbox, Slider, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "../../lib/appSettings";
import type { Repository } from "../../types/git";
import { useGraphActions } from "../graphActions";
import { useHistoryLength } from "../historyLength";

const TICK_SX = { p: 0, "& .MuiSvgIcon-root": { fontSize: 14 } } as const;

// The rail's own height and no more: the touch padding MUI adds would take the name's line.
const RAIL_SX = {
  py: "5px",
  pointerEvents: "all",
  "@media (pointer: coarse)": { py: "5px" },
} as const;

/**
 * How many commits one band shows, and whether it keeps to the length every band is given. Always
 * on the heading, under the name, and there for a repository with no commit at all.
 */
export function HistoryLength({ repository }: { repository: Repository }) {
  const { t } = useTranslation();
  const { historyFollow } = useAppSettings();
  const { visible, free, follow } = useHistoryLength();
  const { setLength } = useGraphActions();

  const most = repository.commits.length;
  const shown = visible.get(repository.id) ?? most;

  return (
    <>
      <span className="band__follow nopan nodrag">
        {historyFollow && (
          <Checkbox
            size="small"
            sx={TICK_SX}
            checked={!free.has(repository.id)}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => follow(repository.id, event.target.checked)}
            title={t("graph.lengthFollow")}
            slotProps={{ input: { "aria-label": t("graph.lengthFollow") } }}
          />
        )}
      </span>
      <Slider
        className="band__rail nopan nodrag nowheel"
        size="small"
        aria-label={t("graph.length")}
        sx={RAIL_SX}
        value={Math.min(shown, most)}
        // An empty history is a rail with nowhere to go, not a rail taken away.
        min={Math.min(1, most)}
        max={Math.max(most, 1)}
        disabled={most <= 1}
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(_, next) => {
          if (typeof next === "number" && next !== shown) setLength(repository.id, next);
        }}
      />
      <Typography className="band__shown" variant="caption">
        {Math.min(shown, most)}
      </Typography>
    </>
  );
}
