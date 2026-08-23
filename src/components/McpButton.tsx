import AddLinkIcon from "@mui/icons-material/AddLink";
import CheckIcon from "@mui/icons-material/Check";
import LinkOffIcon from "@mui/icons-material/LinkOff";
import { Box, Checkbox, Divider, FormControlLabel, Stack } from "@mui/material";
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
 * What the thing is called, which is the only word in the window that is not
 * translated: it is the name of a protocol, and a name is the same word
 * wherever it is read.
 */
const NAME = "mcp";

/**
 * The door the agents say what they are doing through, in the settings dialog.
 *
 * A box beside its own name rather than a mark to be worked out. Everything
 * else in here is a mark because it is a thing done — a theme picked, an update
 * taken — and this is a thing left either on or off for as long as the window
 * is open. A box is what that looks like everywhere else, and the name beside
 * it is there because there is no drawing of MCP anybody would recognise.
 *
 * Ticking it stands the server up: a port held open on this machine, which is
 * exactly the kind of thing a program should not do because it happened to
 * start, so it is off until it is asked for and what was asked for outlives the
 * window.
 *
 * The mark beside it is the other half, and a different half: it writes the one
 * line of setup into the coding agent, which is somebody else's program being
 * told where the door is — done once, and never again, because what is
 * registered is the name of a variable every terminal is handed a value in
 * rather than an address that changes.
 *
 * Neither of them is urgent, which is why both are in here rather than out in
 * the window's own band. What they turn on is drawn on the canvas: a card
 * beside a terminal, saying what the agent in it is working on. Where nothing
 * has been set up there are no cards, and the graph is the graph it always was.
 */
export function McpButton() {
  const { t } = useTranslation();
  const { serving, toggle, installing, register } = useServing();

  return (
    <>
      <Divider flexItem />
      <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
        {/* The name in front of the box, the way it was asked for. What the
            box is *for* is longer than a row of this dialog has in it, so it
            waits under the pointer — the label carries it, and the box inside
            the label answers for it too. */}
        <FormControlLabel
          title={t(serving ? "mcp.stop" : "mcp.serve")}
          label={NAME}
          labelPlacement="start"
          checked={serving}
          onChange={toggle}
          control={<Checkbox size="small" sx={{ p: 0.5 }} />}
          slotProps={{ typography: { variant: "body2", color: "text.secondary" } }}
          sx={{ m: 0, gap: 0.75 }}
        />

        {/* The setup, beside the box rather than under it: it is the other
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
