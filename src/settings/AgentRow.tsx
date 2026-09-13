import { Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import type { Installing } from "../hooks/useServing";
import type { Setup } from "../lib/mcp";
import { PageButton, ROW_HEIGHT } from "./Row";

const PRESS = {
  rest: "mcp.register",
  working: "mcp.registering",
  done: "mcp.registered",
  failed: "mcp.refused",
} as const;

const NAME = 60;

export function AgentRow({
  setup,
  press,
  onPress,
}: {
  setup: Setup;
  press: Installing;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, minHeight: ROW_HEIGHT }}>
      <Typography variant="body2" sx={{ width: NAME, flexShrink: 0 }}>
        {setup.agent}
      </Typography>
      <Typography
        variant="caption"
        component="code"
        className="settings-page__line"
        sx={{ flex: 1, minWidth: 0, color: "text.secondary" }}
      >
        {setup.line}
      </Typography>
      <PageButton danger={press === "failed"} disabled={press === "working"} onClick={onPress}>
        {t(PRESS[press])}
      </PageButton>
    </Stack>
  );
}
