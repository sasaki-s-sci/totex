import { CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { StrictMode, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useDrops } from "../../src/hooks/useDrops";
import { useFileDrops } from "../../src/hooks/useFileDrops";
import { loadSettings } from "../../src/lib/appSettings";
import { keepFrontValue } from "../../src/shell/state";
import { LeftSidebar } from "../../src/sidebar/LeftSidebar";
import { CliView } from "../../src/tab/CliView";
import { appearanceNow, themeFrom } from "../../src/theme";
import "../../src/i18n";

keepFrontValue("folders.panes", [
  { id: 0, kind: "folder", path: "/files", open: true, graphed: [], expanded: [], shown: {} },
]);
await loadSettings();
const { colors, style } = appearanceNow();
const theme = themeFrom(colors, style);

function Fixture() {
  const main = useRef<HTMLDivElement>(null);
  const { openFiles } = useFileDrops();
  const drops = useDrops(main, openFiles);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <div ref={main} style={{ display: "flex", height: "100vh" }}>
        <LeftSidebar open onClose={() => {}} drops={drops} />
        {location.search.includes("terminal") && (
          <div className="page" style={{ position: "relative", width: 500, height: 400 }}>
            <CliView
              session={{ id: "drop-terminal", cwd: "/files", branch: "main" }}
              shown
              onEnded={() => {}}
            />
          </div>
        )}
      </div>
    </ThemeProvider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
