import { Stack, Switch, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import type { ServingControls } from "../hooks/useServing";
import { AgentRow } from "./AgentRow";
import { Row } from "./Row";

export function McpRows({ controls }: { controls: ServingControls }) {
  const { t } = useTranslation();
  const { serving, activity, change, setups, installing, register } = controls;
  const status =
    activity === "idle"
      ? serving
        ? "mcp.on"
        : "mcp.off"
      : activity === "checking"
        ? "mcp.checking"
        : activity === "changing"
          ? "mcp.changing"
          : "mcp.failed";

  return (
    <>
      <Row label={t("settings.mcpServer")}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
          <Typography
            variant="caption"
            sx={{ color: activity === "failed" ? "error.main" : "text.secondary" }}
          >
            {t(status)}
          </Typography>
          <Switch
            size="small"
            checked={serving}
            disabled={activity === "checking" || activity === "changing"}
            onChange={(_, checked) => change(checked)}
            slotProps={{ input: { "aria-label": t("settings.mcpServer") } }}
          />
        </Stack>
      </Row>
      <Row label={t("settings.register")} />
      <Stack sx={{ gap: 0.5, pl: 1.5 }}>
        {setups.map((setup) => (
          <AgentRow
            key={setup.agent}
            setup={setup}
            press={installing[setup.agent] ?? "rest"}
            onPress={() => register(setup.agent)}
          />
        ))}
      </Stack>
    </>
  );
}
