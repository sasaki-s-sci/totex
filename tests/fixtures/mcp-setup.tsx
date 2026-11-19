import { ThemeProvider } from "@mui/material/styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadSettings } from "../../src/lib/appSettings";
import { keepFrontValue, snapshot } from "../../src/shell/state";
import { appearanceNow, themeFrom } from "../../src/theme";
import "../../src/i18n";

keepFrontValue("sessions.list", [
  { id: "mcp-local", cwd: "/projects/local", branch: "local" },
  { id: "mcp-wsl", cwd: "\\\\wsl.localhost\\Ubuntu\\home\\a\\project", branch: "wsl" },
]);
keepFrontValue("sessions.active", "mcp-local");
keepFrontValue("window.settings", 1);
keepFrontValue("files.open", []);
keepFrontValue("folders.panes", []);
await loadSettings();
const { colors, style } = appearanceNow();
const theme = themeFrom(colors, style);
const { Window } = await import("../../src/window/Window");
Object.assign(window, { mcpSetupSnapshot: snapshot });
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <Window />
    </ThemeProvider>
  </StrictMode>,
);
