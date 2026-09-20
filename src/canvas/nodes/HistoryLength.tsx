import { Checkbox, Popover, Slider, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "../../lib/appSettings";
import { LengthMark } from "../../marks";
import type { Repository } from "../../types/git";
import { useGraphActions } from "../graphActions";
import { useHistoryLength } from "../historyLength";

const TICK_SX = { p: 0.25 } as const;

/** How many commits one band shows, and whether it keeps to the length every band is given. */
export function HistoryLength({ repository }: { repository: Repository }) {
  const { t } = useTranslation();
  const { historyFollow } = useAppSettings();
  const { visible, free, follow } = useHistoryLength();
  const { fold } = useGraphActions();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  const most = repository.commits.length;
  const shown = visible.get(repository.id) ?? most;

  return (
    <>
      <button
        type="button"
        className="band__close band__length nopan"
        aria-label={t("graph.length")}
        aria-haspopup="dialog"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(event.currentTarget);
        }}
      >
        <LengthMark />
      </button>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        // Above the heading: the band it is changing lies under it.
        anchorOrigin={{ vertical: "top", horizontal: "left" }}
        transformOrigin={{ vertical: "bottom", horizontal: "left" }}
        slotProps={{ paper: { className: "nopan nowheel nodrag" } }}
      >
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, px: 1.5, py: 0.5 }}>
          {historyFollow && (
            <Checkbox
              size="small"
              sx={TICK_SX}
              checked={!free.has(repository.id)}
              onChange={(event) => follow(repository.id, event.target.checked)}
              title={t("graph.lengthFollow")}
              slotProps={{ input: { "aria-label": t("graph.lengthFollow") } }}
            />
          )}
          <Slider
            size="small"
            aria-label={t("graph.length")}
            sx={{ width: 160 }}
            value={shown}
            min={1}
            max={Math.max(most, 1)}
            disabled={most <= 1}
            onChange={(_, next) => {
              if (typeof next === "number" && next !== shown) fold(repository.id, next);
            }}
          />
          <Typography
            variant="body2"
            sx={{ minWidth: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
          >
            {shown}
          </Typography>
        </Stack>
      </Popover>
    </>
  );
}
