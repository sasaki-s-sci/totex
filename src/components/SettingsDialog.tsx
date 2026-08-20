import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import TerminalIcon from "@mui/icons-material/Terminal";
import { Box, Dialog, Divider, Stack, ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useTranslation } from "react-i18next";
import { AGENT_IDS, AGENTS, type AgentId } from "../lib/agents";
import type { Surface } from "../lib/session";
import { useSettings } from "../settings";
import { AgentIcon } from "./AgentIcon";

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * The two choices the window has, as marks.
 *
 * Above the rule: where an agent opens — its own screen in a terminal, or the
 * chat panel, one run of the agent per message. Below it: which agents get a
 * button on every branch, which is the same row of marks that then appears at
 * the end of every branch's line. Pressing one here is what it looks like
 * there, so there is nothing to explain about either.
 *
 * An agent whose command is not installed is switched off here rather than
 * described: what happens otherwise is a terminal that opens and finds nothing,
 * which is a thing to see rather than a thing to be warned about.
 */
export function SettingsDialog({ open, onClose }: Props) {
  const { t } = useTranslation();
  const { settings, update } = useSettings();

  const toggle = (id: AgentId, wanted: boolean) =>
    update({
      agents: AGENT_IDS.filter((other) =>
        other === id ? wanted : settings.agents.includes(other),
      ),
    });

  return (
    <Dialog open={open} onClose={onClose}>
      <Stack spacing={1} sx={{ p: 1.25, alignItems: "center" }}>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={settings.surface}
          onChange={(_, next: Surface | null) => next && update({ surface: next })}
        >
          <ToggleButton value="cli" aria-label={t("settings.terminal")} sx={{ px: 1.5, py: 0.5 }}>
            <TerminalIcon fontSize="small" />
          </ToggleButton>
          <ToggleButton value="chat" aria-label={t("settings.chat")} sx={{ px: 1.5, py: 0.5 }}>
            <ChatBubbleOutlineIcon fontSize="small" />
          </ToggleButton>
        </ToggleButtonGroup>

        <Divider flexItem />

        <Stack direction="row" spacing={0.5}>
          {AGENTS.map((agent) => {
            const on = settings.agents.includes(agent.id);
            return (
              <Box
                key={agent.id}
                component="button"
                type="button"
                aria-label={agent.label}
                aria-pressed={on}
                onClick={() => toggle(agent.id, !on)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: 34,
                  height: 30,
                  p: 0,
                  border: 1,
                  borderColor: on ? "divider" : "transparent",
                  borderRadius: 1,
                  background: "none",
                  color: agent.colour,
                  opacity: on ? 1 : 0.3,
                  cursor: "pointer",
                  transition: "opacity 90ms ease-out",
                }}
              >
                <AgentIcon agent={agent.id} />
              </Box>
            );
          })}
        </Stack>
      </Stack>
    </Dialog>
  );
}
