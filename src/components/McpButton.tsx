import AddLinkIcon from "@mui/icons-material/AddLink";
import CheckIcon from "@mui/icons-material/Check";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import SensorsIcon from "@mui/icons-material/Sensors";
import { Box, Divider, Stack, ToggleButton } from "@mui/material";
import { useTranslation } from "react-i18next";

import { useServing } from "../hooks/useServing";
import { MarkButton } from "./marks";

/** What each state of the second mark is, for something reading it aloud. */
const REGISTER = {
  rest: "mcp.register",
  working: "mcp.registering",
  done: "mcp.registered",
  failed: "mcp.refused",
} as const;

/**
 * The door the agents say what they are doing through, in the settings dialog.
 *
 * Two marks, and they are two things. The first stands the server up: a port
 * held open on this machine, which is exactly the kind of thing a program
 * should not do because it happened to start, so it is off until it is asked
 * for and what was asked for outlives the window. The second writes the one
 * line of setup into the coding agent, which is somebody else's program being
 * told where the door is — done once, and never again, because what is
 * registered is the name of a variable every terminal is handed a value in
 * rather than an address that changes.
 *
 * Neither of them is a thing to be done twice, and neither is urgent, which is
 * why both are in here rather than out in the window's own band. What they turn
 * on is drawn on the canvas: a card beside a terminal, saying what the agent in
 * it is working on. Where nothing has been set up there are no cards, and the
 * graph is the graph it always was.
 */
export function McpButton() {
  const { t } = useTranslation();
  const { serving, toggle, installing, register } = useServing();

  return (
    <>
      <Divider flexItem />
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        <ToggleButton
          value="serving"
          selected={serving}
          size="small"
          aria-label={t(serving ? "mcp.stop" : "mcp.serve")}
          onChange={toggle}
          sx={{ px: 1.5, py: 0.5 }}
        >
          <SensorsIcon sx={{ fontSize: 16 }} />
        </ToggleButton>

        {/* The setup, beside the switch rather than under it: it is the other
            half of the same arrangement, and it is only ever pressed once. */}
        <MarkButton label={t(REGISTER[installing])} onClick={register}>
          <Box
            sx={{
              display: "flex",
              color: installing === "failed" ? "error.main" : undefined,
            }}
          >
            {installing === "done" ? (
              <CheckIcon sx={{ fontSize: 16 }} />
            ) : installing === "failed" ? (
              <LinkOffIcon sx={{ fontSize: 16 }} />
            ) : (
              <AddLinkIcon sx={{ fontSize: 16 }} />
            )}
          </Box>
        </MarkButton>
      </Stack>
    </>
  );
}
