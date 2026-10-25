import { Box, CssBaseline, Stack, Typography } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { mockIPC } from "@tauri-apps/api/mocks";
import { ReactFlow } from "@xyflow/react";
import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { CliJumpsProvider } from "../../src/canvas/cliJumps";
import { GraphLines } from "../../src/canvas/GraphLines";
import { GraphActionsProvider, NO_ACTIONS } from "../../src/canvas/graphActions";
import { CliNode } from "../../src/canvas/nodes/CliNode";
import { FolderNode } from "../../src/canvas/nodes/FolderNode";
import { OfferNode } from "../../src/canvas/nodes/OfferNode";
import { TileNode } from "../../src/canvas/nodes/TileNode";
import { loadSettings, updateSettings, useAppSettings } from "../../src/lib/appSettings";
import {
  DEFAULT_SETTINGS,
  mergeMonitor,
  type SettingsPatch,
  settingsFrom,
} from "../../src/lib/appSettingsModel";
import { buildCommitGraph } from "../../src/lib/graph/build";
import type { Session } from "../../src/lib/session";
import { MonitorBadge } from "../../src/monitor/MonitorBadge";
import { useMonitorRuntime } from "../../src/monitor/runtime";
import { MonitorRows } from "../../src/settings/MonitorRows";
import { appearanceNow, themeFrom } from "../../src/theme";
import "../../src/i18n";
import "../../src/canvas/styles/index.css";

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
      ...["running", "permission", "failure"].map((id) => ({
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
    return ["running", "permission", "failure"].map((status) => ({
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
function fixtureGraph(cardWidth: number) {
  const graph = buildCommitGraph({
    workspace: { root: "/tmp", repositories: [], warnings: [] },
    folders: [
      { root: "/tmp", name: "tmp", kind: "folder", repositories: [] },
      { root: "/tmp/empty", name: "empty", kind: "folder", repositories: [] },
    ],
    sessions: ["running", "terminal"].map((id) => ({
      id,
      cwd: "/tmp",
      branch: "tmp",
      folder: true,
    })),
    visible: new Map(),
    opened: new Map(),
    closed: new Set(),
    tiles: new Map(),
    cardWidth,
    step: 24,
    showing: "running",
    reports: new Map(),
    reaching: null,
    places: new Map(),
  });
  graph.nodes = graph.nodes.map((node) => ({
    ...node,
    className: node.id === "tileterminal" ? "fixture-terminal" : undefined,
  }));
  return graph;
}
const nodeTypes = { cli: CliNode, folder: FolderNode, tile: TileNode, offer: OfferNode };
const jumps = {
  showing: "sessionrunning",
  numbers: new Map([
    ["sessionrunning", 1],
    ["sessionterminal", 2],
  ]),
};
function Fixture() {
  useMonitorRuntime();
  const { monitor } = useAppSettings();
  const [offering, setOffering] = useState(false);
  Object.assign(window, { monitorOffers: setOffering });
  const graph = useMemo(() => fixtureGraph(monitor.previewWidth), [monitor.previewWidth]);
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
        <Box className="graph fixture-graph" sx={{ width: 480, height: 200 }}>
          <GraphActionsProvider value={graphActions}>
            <CliJumpsProvider value={jumps}>
              <ReactFlow
                nodes={offering ? [...graph.nodes, ...graph.offers] : graph.nodes}
                nodeTypes={nodeTypes}
                fitView
                maxZoom={1}
                proOptions={{ hideAttribution: true }}
              >
                <GraphLines
                  {...graph}
                  selected={null}
                  picked={null}
                  offering={offering}
                  reading={false}
                  onCommit={() => {}}
                />
              </ReactFlow>
            </CliJumpsProvider>
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
