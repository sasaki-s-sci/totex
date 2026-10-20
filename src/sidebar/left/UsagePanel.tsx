import { Box, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import { baseName } from "../../folder/format";
import type { TerminalUsage } from "./useTerminalUsage";

const GIB = 2 ** 30;
const MIB = 2 ** 20;

function formatCpu(percent: number | null): string {
  return percent === null ? "–" : `${Math.round(percent)}%`;
}

function formatMemory(bytes: number): string {
  return bytes >= GIB ? `${(bytes / GIB).toFixed(1)} GB` : `${Math.round(bytes / MIB)} MB`;
}

/** Every terminal's CPU and memory, with the total on top; sits at the foot of the left sidebar. */
export function UsagePanel({ usage }: { usage: TerminalUsage[] }) {
  const { t } = useTranslation();
  const cpu = usage.reduce((sum, one) => sum + (one.cpu ?? 0), 0);
  const memory = usage.reduce((sum, one) => sum + one.memory, 0);
  const figures = { fontVariantNumeric: "tabular-nums" } as const;

  return (
    <Box
      component="section"
      aria-label={t("usage.title")}
      sx={{
        flex: "none",
        maxHeight: 160,
        overflowY: "auto",
        borderTop: 1,
        borderColor: "divider",
        px: 1.5,
        py: 0.75,
      }}
    >
      <Stack direction="row" sx={{ justifyContent: "space-between", gap: 1 }}>
        <Typography variant="caption" color="text.secondary">
          {t("usage.title")}
        </Typography>
        <Typography variant="caption" sx={figures}>
          {usage.length === 0 ? t("usage.none") : `${formatCpu(cpu)} · ${formatMemory(memory)}`}
        </Typography>
      </Stack>
      {usage.map((one) => (
        <Stack key={one.id} direction="row" sx={{ justifyContent: "space-between", gap: 1 }}>
          <Typography variant="caption" noWrap title={one.cwd} sx={{ minWidth: 0 }}>
            {baseName(one.cwd)}
          </Typography>
          <Typography variant="caption" sx={{ ...figures, flex: "none" }}>
            {formatCpu(one.cpu)} · {formatMemory(one.memory)}
          </Typography>
        </Stack>
      ))}
    </Box>
  );
}
