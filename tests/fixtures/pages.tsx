import { ThemeProvider } from "@mui/material/styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadSettings } from "../../src/lib/appSettings";
import { keepFrontValue, snapshot } from "../../src/shell/state";
import { theme } from "../../src/theme";
import "../../src/i18n";

keepFrontValue("sessions.list", [{ id: "terminal-one", cwd: "/tmp", branch: "main" }]);
keepFrontValue("sessions.showing", "terminal-one");
keepFrontValue("files.open", [{ id: 1, path: "/tmp/note.txt", at: { x: 380, y: 240 } }]);
keepFrontValue("window.settings", 1);
keepFrontValue("canvas.viewport", { x: 0, y: 0, zoom: 1 });
await loadSettings();
const { Window } = await import("../../src/window/Window");
Object.assign(window, { pageSnapshot: snapshot });
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <Window />
    </ThemeProvider>
  </StrictMode>,
);
