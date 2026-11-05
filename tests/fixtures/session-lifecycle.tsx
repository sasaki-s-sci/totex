import { createRoot } from "react-dom/client";
import { keepFrontValue, snapshot } from "../../src/shell/state";

keepFrontValue("sessions.list", [
  { id: "visible", cwd: "/repo", branch: "feature" },
  { id: "other", cwd: "/other", branch: "main" },
]);
const { useSessions } = await import("../../src/hooks/useSessions");
function Fixture() {
  const sessions = useSessions();
  Object.assign(window, { endWorktree: sessions.endIn, sessionSnapshot: snapshot });
  return (
    <div>
      {sessions.sessions.map((session) => (
        <span key={session.id}>{session.id}</span>
      ))}
    </div>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(<Fixture />);
