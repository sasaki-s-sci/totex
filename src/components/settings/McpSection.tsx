/**
 * The door the agents say what they are working on through.
 */

import { Divider, Switch } from "@mui/material";
import { useTranslation } from "react-i18next";

import { useServing } from "../../hooks/useServing";
import { PageButton, Row } from "./Row";

/** What each state of the setup button is. */
const REGISTER = {
  rest: "mcp.register",
  working: "mcp.registering",
  done: "mcp.registered",
  failed: "mcp.refused",
} as const;

/**
 * The door the agents say what they are working on through: the server this
 * window stands beside its terminals, and the one line of setup that tells an
 * agent where it is.
 *
 * Two rows, because they are two things. The switch stands a port open on this
 * machine, which is exactly the kind of thing a program should not do because
 * it happened to start — so it is off until it is asked for, and what was asked
 * for outlives the window. The button under it writes the setup into somebody
 * else's program, which is done once and never again: what is registered is the
 * name of a variable every terminal is handed a value in, rather than an
 * address that changes.
 *
 * Neither is urgent, which is why both are in here rather than out in the one
 * row the window reserves. What they turn on is drawn on the canvas: a card
 * beside a terminal, saying what the agent in it is working on.
 */
export function McpSection() {
  const { t } = useTranslation();
  const { serving, toggle, installing, register } = useServing();

  return (
    <>
      <Divider />
      <Row label={t("settings.mcp")} hint={t("settings.mcpHint")}>
        {/* The name is drawn beside it rather than tied to it, so the box
            says what it is for itself to anything reading the page aloud. */}
        <Switch
          size="small"
          checked={serving}
          onChange={toggle}
          slotProps={{ input: { "aria-label": t("settings.mcp") } }}
        />
      </Row>
      <Row label={t("settings.register")} hint={t("settings.registerHint")}>
        <PageButton
          danger={installing === "failed"}
          disabled={installing === "working"}
          onClick={register}
        >
          {t(REGISTER[installing])}
        </PageButton>
      </Row>
    </>
  );
}
