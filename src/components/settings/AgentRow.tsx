/**
 * One coding agent, the line that sets it up, and the press that runs it.
 */

import { Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import type { Installing } from "../../hooks/useServing";
import type { Setup } from "../../lib/mcp";
import { PageButton } from "./Row";

/** What each state of the press is called. */
const PRESS = {
  rest: "mcp.register",
  working: "mcp.registering",
  done: "mcp.registered",
  failed: "mcp.refused",
} as const;

/**
 * The column the agents are named in.
 *
 * Wide enough for either name, so that the lines start at the same place on
 * both rows: two commands under one another are a pair to choose between, and
 * two commands at different indents are a list to read through.
 */
const NAME = 60;

/**
 * One agent, and what registering this window's server with it would do.
 *
 * The line is the row. It is shown rather than hidden behind the button because
 * this is the one press on the page that reaches into another program on the
 * machine, and a button that will not say what it would do is a button that has
 * to be trusted instead of read. It is left selectable for the same reason:
 * where this window cannot reach the agent — another machine, a container, a
 * distribution it has no way into — the line is still the answer, and copying
 * it is the way to use it.
 */
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
    <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, minHeight: 34 }}>
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
