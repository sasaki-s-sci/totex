import { Box, CssBaseline, Stack, Typography } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";
import { loadSettings, updateSettings } from "../../src/lib/appSettings";
import {
  DEFAULT_SETTINGS,
  mergeMonitor,
  type SettingsPatch,
  settingsFrom,
} from "../../src/lib/appSettingsModel";
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
    command: "agent-acp",
    model: "chosen-model",
    features: { estimate: true },
  },
});
const documentValue = () => ({
  path: "/tmp/monitor-settings.json",
  text: JSON.stringify(value),
  value,
});
const calls: { cmd: string; payload: unknown }[] = [];
Object.assign(window, {
  monitorCalls: calls,
  monitorLanguage: (language: "en" | "ja") => updateSettings({ language }),
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
  if (cmd === "monitor_snapshots")
    return ["running", "permission", "failure"].map((status) => ({
      id: status,
      environment: "SSH · workstation",
      source: "inferred",
      status,
      goal: { status: "active", summary: "Ship the editor update" },
      taskSummary: "Implementing the editor",
      requestSummary: "Add keyboard navigation to the editor",
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
        {["running", "permission", "failure"].map((id) => (
          <MonitorBadge key={id} id={id} />
        ))}
        <Box sx={{ position: "relative", width: 16, height: 16 }}>
          <MonitorBadge id="running" canvas />
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
