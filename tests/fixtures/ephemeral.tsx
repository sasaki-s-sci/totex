import { ThemeProvider } from "@mui/material/styles";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CliView } from "../../src/components/CliView";
import { Row } from "../../src/components/settings/Row";
import { ephemeralIdentity, swapEphemeral } from "../../src/ephemeral/runtime";
import { askStanding, take } from "../../src/lib/update";
import { theme } from "../../src/theme";

const sessions = [1, 2, 3].map((number) => ({
  id: `session-${number}`,
  cwd: "/tmp",
  branch: "main",
}));
function Fixture() {
  const [text, setText] = useState("");
  return (
    <ThemeProvider theme={theme}>
      <Row label="Original view">
        <input aria-label="Draft" value={text} onChange={(event) => setText(event.target.value)} />
      </Row>
      {sessions.map((session) => (
        <div key={session.id} style={{ height: 140, width: 620, position: "relative" }}>
          <CliView
            session={session}
            shown
            onEnded={() => {
              throw new Error("A session ended during a view update");
            }}
          />
        </div>
      ))}
    </ThemeProvider>
  );
}
await swapEphemeral();
await askStanding();
Object.assign(window, { testUpdate: take, testIdentity: ephemeralIdentity });
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<Fixture />);
