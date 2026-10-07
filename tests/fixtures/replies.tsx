import { ThemeProvider } from "@mui/material/styles";
import { ReactFlow } from "@xyflow/react";
import { createRoot } from "react-dom/client";
import { ReportNode } from "../../src/canvas/nodes/ReportNode";
import { useOverseer } from "../../src/hooks/useOverseer";
import { useReports } from "../../src/hooks/useReports";
import { reportCard } from "../../src/lib/graph/reporting";
import { mergedReports } from "../../src/lib/overseen";
import { appearanceNow, themeFrom } from "../../src/theme";
import "../../src/i18n";
import "@xyflow/react/dist/style.css";
import "../../src/canvas/styles/report.css";

const session = { id: "terminal", cwd: "/tmp", branch: "main" };
const { colors, style } = appearanceNow();
const theme = themeFrom(colors, style);
const nodeTypes = { report: ReportNode };
function Fixture() {
  const reports = useReports();
  const overseer = useOverseer();
  const report = mergedReports(reports, overseer.statuses, overseer.session !== null).get(
    "terminal",
  );
  const card = report ? reportCard(report) : null;
  const nodes =
    report && card
      ? [
          {
            id: "reply",
            type: "report",
            position: { x: 80, y: 80 },
            data: { session, report, card },
            style: { width: 280, height: card.height },
          },
        ]
      : [];
  return (
    <ThemeProvider theme={theme}>
      <div style={{ width: "100vw", height: "100vh" }}>
        <ReactFlow nodes={nodes} nodeTypes={nodeTypes} />
      </div>
    </ThemeProvider>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<Fixture />);
