import { ThemeProvider } from "@mui/material/styles";
import { Fragment, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadSettings } from "../../src/lib/appSettings";
import { keepFrontValue, snapshot } from "../../src/shell/state";
import { appearanceNow, themeFrom } from "../../src/theme";
import "../../src/i18n";

if (location.search.includes("terminal-resize") || location.search.includes("terminal-rendering")) {
  const { Terminal } = await import("@xterm/xterm");
  const terminals = new Map<string, InstanceType<typeof Terminal>>();
  const open = Terminal.prototype.open;
  Terminal.prototype.open = function (parent) {
    open.call(this, parent);
    terminals.set(parent.dataset.terminal ?? "", this);
  };
  Object.assign(window, { pageTerminals: terminals });
}

const ordering = location.search.includes("ordering");
const groupedSessions = [
  { id: "terminal-two", cwd: "/tmp", branch: "worker", ...(ordering ? { folder: true } : {}) },
  { id: "terminal-other", cwd: ordering ? "/elsewhere/tmp" : "/elsewhere", branch: "other" },
];
if (ordering) groupedSessions.reverse();
keepFrontValue("sessions.list", [
  { id: "terminal-one", cwd: "/tmp", branch: "main" },
  ...(location.search.includes("grouped") ? groupedSessions : []),
]);
keepFrontValue(
  "files.open",
  location.search.includes("onlyterminals")
    ? []
    : [{ id: 1, path: "/tmp/note.txt", folder: "/tmp", at: { x: 380, y: 240 } }],
);
keepFrontValue("window.settings", location.search.includes("canvas") ? 0 : 1);
if (location.search.includes("sidebar-closed")) keepFrontValue("pages.sidebarOpen", false);
if (location.search.includes("columns")) {
  keepFrontValue("cards.layout", [["folder:/tmp", "folder:/elsewhere"]]);
  keepFrontValue("pages.expandedTerminals", ["terminal:terminal-other"]);
  keepFrontValue("cards.height.terminal:terminal-other", 600);
}
if (
  location.search.includes("offers") ||
  location.search.includes("terminals") ||
  location.search.includes("mixed")
) {
  keepFrontValue("folders.panes", [
    {
      id: 0,
      kind: "folder",
      path: "/tmp",
      open: location.search.includes("mixed"),
      graphed: !location.search.includes("offers") ? ["/tmp"] : ["/empty-a", "/empty-b"],
      expanded: [],
      shown: {},
    },
  ]);
}
await loadSettings();
const { colors, style } = appearanceNow();
const theme = themeFrom(colors, style);
const { Window } = await import("../../src/window/Window");
Object.assign(window, { pageSnapshot: snapshot });
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
// Measure production terminal identity without StrictMode's effect replay on keyed moves.
const Mode = ordering ? Fragment : StrictMode;
createRoot(root).render(
  <Mode>
    <ThemeProvider theme={theme}>
      <Window />
    </ThemeProvider>
  </Mode>,
);
