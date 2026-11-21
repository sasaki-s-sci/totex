import { Alert, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { createRoot } from "react-dom/client";
import { SessionCanvas } from "../canvas/Canvas";
import { useCanvases } from "../canvas/useCanvases";
import { swapEphemeral } from "../ephemeral/runtime";
import { loadSettings, settingsNow } from "../lib/appSettings";
import type { Session } from "../lib/session";
import { appearanceNow, applyStoredMode, themeFrom } from "../theme";
import { loadThemes } from "../theme/registry";
import { canvasRequest } from "./bridge";
import "../i18n";
import "../theme/rail.css";

function BrowserCanvas({ session }: { session: Session }) {
  const state = useCanvases();
  return (
    <main className="terminal-canvases" aria-label={session.branch || session.cwd}>
      <SessionCanvas
        id={session.id}
        cwd={session.cwd}
        shown
        panes={state.canvases[session.id]?.panes ?? []}
        change={state.change}
        registerSave={state.registerSave}
      />
      {state.error && (
        <Alert className="canvas-error" severity="error" onClose={state.clearError}>
          {state.error}
        </Alert>
      )}
    </main>
  );
}

export async function start() {
  const [session] = await Promise.all([
    canvasRequest<Session>("session"),
    loadSettings(),
    loadThemes(),
    swapEphemeral(),
  ]);
  const root = document.getElementById("root");
  if (!root) throw new Error("Missing canvas root");
  document.title = `${session.branch || session.cwd} · totex canvas`;
  applyStoredMode();
  const { colors, style } = appearanceNow();
  document.documentElement.style.setProperty("--totex-mono", style.font.mono);
  createRoot(root).render(
    <ThemeProvider
      theme={themeFrom(colors, style)}
      defaultMode={settingsNow().theme}
      storageManager={null}
    >
      <CssBaseline />
      <BrowserCanvas session={session} />
    </ThemeProvider>,
  );
}
