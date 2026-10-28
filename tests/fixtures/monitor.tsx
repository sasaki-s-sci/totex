import { Box, CssBaseline, Stack, Typography } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";
import { GraphActionsProvider, NO_ACTIONS } from "../../src/canvas/graphActions";
import { CardBoard } from "../../src/cards/CardBoard";
import { loadSettings, updateSettings } from "../../src/lib/appSettings";
import {
  DEFAULT_SETTINGS,
  mergeMonitor,
  type SettingsPatch,
  settingsFrom,
} from "../../src/lib/appSettingsModel";
import type { Session } from "../../src/lib/session";
import { MonitorBadge } from "../../src/monitor/MonitorBadge";
import { useMonitorRuntime } from "../../src/monitor/runtime";
import { MonitorRows } from "../../src/settings/MonitorRows";
import { appearanceNow, themeFrom } from "../../src/theme";
import "../../src/i18n";

let value = settingsFrom({
  ...DEFAULT_SETTINGS,
  language: "en",
  monitor: {
    enabled: true,
    agent: "claude",
    model: "claude-sonnet",
    features: { estimate: true },
  },
});
const documentValue = () => ({
  path: "/tmp/monitor-settings.json",
  text: JSON.stringify(value),
  value,
});
const calls: { cmd: string; payload: unknown }[] = [];
let terminalTail = "first output line\n  last output line";
let summaries = true;
const ended: string[] = [];
const opened: string[] = [];
const graphActions = {
  ...NO_ACTIONS,
  endSession: (session: Session) => {
    ended.push(session.id);
  },
  openWork: (work: Parameters<typeof NO_ACTIONS.openWork>[0]) => {
    if (work.cwd) opened.push(work.cwd);
  },
};
Object.assign(window, {
  monitorCalls: calls,
  monitorEnded: ended,
  monitorOpened: opened,
  monitorLanguage: (language: "en" | "ja") => updateSettings({ language }),
  monitorTail: (tail: string) => {
    terminalTail = tail;
  },
  monitorSummaries: (shown: boolean) => {
    summaries = shown;
  },
  monitorWidth: (previewWidth: 160 | 220 | 320 | 420) =>
    updateSettings({ monitor: { previewWidth } }),
});
mockIPC((cmd, payload) => {
  calls.push({ cmd, payload });
  if (cmd === "app_settings_read") return documentValue();
  if (cmd === "app_settings_patch") {
    const patch = payload?.patch as SettingsPatch;
    value = settingsFrom({
      ...value,
      ...patch,
      monitor: mergeMonitor(value.monitor, patch.monitor),
    });
    return documentValue();
  }
  if (cmd === "monitor_configure" || cmd === "monitor_refresh") return null;
  if (cmd === "pty_standing")
    return [
      ...["running", "permission", "failure", "terminal"].map((id) => ({
        id,
        doing: id === "running" ? "working" : "agent",
        asking: id === "permission",
        said: "Add keyboard navigation to the editor",
        running: "claude",
        tail: "agent output",
      })),
      {
        id: "terminal",
        doing: "running",
        asking: false,
        said: "npm run dev",
        running: "npm run dev",
        tail: terminalTail,
      },
    ];
  if (cmd === "monitor_models") {
    const { agent, command } = payload as { agent: string; command: string };
    // Listing starts the agent CLI, so the answer is never immediate.
    return new Promise((resolve, reject) =>
      setTimeout(() => {
        if (agent === "codex") reject("codex: command not found");
        else
          resolve({
            environment: agent === "custom" ? `SSH · ${command}` : "WSL · Ubuntu-24.04",
            current: "claude-sonnet",
            models: [
              { id: "claude-sonnet", name: "Sonnet", description: "Balanced everyday model" },
              { id: "claude-opus", name: "Opus", description: "Most capable for long tasks" },
              { id: "claude-haiku", name: "Haiku", description: null },
            ],
          });
      }, 200),
    );
  }
  if (cmd === "monitor_snapshots")
    return ["running", "permission", "failure", "terminal"].map((status) => ({
      id: status,
      environment: "SSH · workstation",
      source: "inferred",
      status,
      goal: { status: "active", summary: "Ship the editor update" },
      taskSummary: summaries ? "Implementing the editor" : null,
      requestSummary: summaries ? "Add keyboard navigation to the editor" : null,
      estimate: { seconds: 960, confidence: "medium" },
      updatedAt: Date.now(),
      error: status === "failure" ? "ACP connection closed" : null,
      monitorStatus: status === "failure" ? "failure" : "idle",
      agents: [
        {
          id: "m",
          kind: "monitor",
          source: "observed",
          label: "monitor",
          status: "stopped",
          detail: "chosen-model",
        },
        {
          id: "s",
          kind: "shell",
          source: "observed",
          label: "shell",
          status: "running",
          detail: "SSH",
        },
        {
          id: "a",
          kind: "subagent",
          source: "inferred",
          label: "Keyboard navigation",
          status,
          detail: "Testing focus order",
          progress: 60,
        },
        {
          id: "b",
          kind: "background",
          source: "inferred",
          label: "Build",
          status: "running",
          detail: "Compiling editor",
          progress: null,
        },
      ],
    }));
  return null;
});
await loadSettings();
const { colors, style } = appearanceNow();
function Fixture() {
  useMonitorRuntime();
  return (
    <Stack direction="row" spacing={4} sx={{ p: 3, alignItems: "flex-start" }}>
      <Box sx={{ width: 420 }}>
        <Typography variant="h6">Monitor</Typography>
        <MonitorRows />
      </Box>
      <Stack spacing={3} sx={{ pt: 5 }}>
        {["running", "permission", "failure", "terminal"].map((id) => (
          <MonitorBadge key={id} id={id} />
        ))}
        <Box className="fixture-cards" sx={{ position: "relative", width: 480, height: 500 }}>
          <GraphActionsProvider value={graphActions}>
            <CardBoard
              workspace={{ root: "/tmp", repositories: [], warnings: [] }}
              folders={[{ root: "/tmp", name: "tmp", kind: "folder", repositories: [] }]}
              sessions={["running", "terminal"].map((id) => ({
                id,
                cwd: "/tmp",
                branch: "tmp",
                folder: true,
              }))}
              showing="running"
              nodes={[]}
            />
          </GraphActionsProvider>
        </Box>
      </Stack>
    </Stack>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <ThemeProvider theme={themeFrom(colors, style)}>
    <CssBaseline />
    <Fixture />
  </ThemeProvider>,
);
