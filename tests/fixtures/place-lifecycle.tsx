import { createRoot } from "react-dom/client";
import { loadSettings } from "../../src/lib/appSettings";
import { keepFrontValue, snapshot } from "../../src/shell/state";
import "../../src/i18n";

keepFrontValue("folders.panes", [
  {
    id: 1,
    kind: "folder",
    path: "/projects/notes",
    open: true,
    graphed: ["/projects/notes"],
    expanded: [],
    shown: {},
  },
  {
    id: 2,
    kind: "repository",
    path: "/projects/app",
    open: true,
    graphed: ["/projects/app"],
    expanded: [],
    shown: {},
  },
]);
keepFrontValue("window.foldersOpen", true);
keepFrontValue("sessions.list", [
  { id: "folder-cli", cwd: "/projects/notes", branch: "notes", folder: true },
  { id: "repo-cli", cwd: "/projects/app", branch: "main" },
]);
keepFrontValue("sessions.paged", ["repo-cli"]);
keepFrontValue("canvas.viewport", { x: 0, y: 0, zoom: 1 });
await loadSettings();
const { default: App } = await import("../../src/App");
Object.assign(window, { placeSnapshot: snapshot });
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<App />);
