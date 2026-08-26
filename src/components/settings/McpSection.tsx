/**
 * The door the agents say what they are working on through.
 */

import { Divider, Stack, Switch, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import type { ServingControls } from "../../hooks/useServing";
import { AgentRow } from "./AgentRow";
import { Row } from "./Row";

/**
 * The door the agents say what they are working on through: the server this
 * window stands beside its terminals, and the setup that tells an agent where
 * it is.
 *
 * Two things, because they are two things. The switch stands a port open on
 * this machine, which is exactly the kind of thing a program should not do
 * because it happened to start — so it is off until it is asked for, and what
 * was asked for outlives the window. The lines under it are written into
 * somebody else's program, which is done once and rarely again: what is
 * registered is the same for every session there will ever be.
 *
 * One line per agent, because the agents cannot be told the same thing. Where
 * one expands a variable into an address and is handed a door of its own, the
 * other takes a literal address and is handed the door itself with the session
 * named in the request instead — see `mcp::install`. Neither is this side's
 * choice, so both are on the page, in the words they would be typed in.
 *
 * Neither the switch nor the lines are urgent, which is why they are in here
 * rather than out in the one row the window reserves. What they turn on is
 * drawn on the canvas: a card beside a terminal, saying what the agent in it is
 * working on.
 */
export function McpSection({ controls }: { controls: ServingControls }) {
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
      <Divider />
      <Row label={t("settings.mcp")}>
        <Stack direction="row" sx={{ alignItems: "center", gap: 0.5 }}>
          <Typography
            variant="caption"
            sx={{ color: activity === "failed" ? "error.main" : "text.secondary" }}
          >
            {t(status)}
          </Typography>
          {/* The name is drawn beside it rather than tied to it, so the box
              says what it is for itself to anything reading the page aloud. */}
          <Switch
            size="small"
            checked={serving}
            disabled={activity === "checking" || activity === "changing"}
            onChange={(_, checked) => change(checked)}
            slotProps={{ input: { "aria-label": t("settings.mcp") } }}
          />
        </Stack>
      </Row>
      <Row label={t("settings.register")} hint={t("settings.registerHint")} />
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
