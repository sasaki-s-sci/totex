export type AgentStatus = "unknown" | "running" | "permission" | "stopped" | "success" | "failure";
export type MonitorSnapshot = {
  id: string;
  environment: string;
  source: "inferred" | "observed";
  status: AgentStatus;
  goal: null | { status: "active" | "paused" | "blocked" | "complete"; summary: string };
  taskSummary: string | null;
  requestSummary: string | null;
  estimate: null | { seconds: number; confidence: "low" | "medium" | "high" };
  agents: {
    id: string;
    kind: "monitor" | "shell" | "subagent" | "background";
    label: string;
    source: "observed" | "inferred";
    status: AgentStatus;
    detail: string;
    progress?: number | null;
  }[];
  updatedAt: number;
  error: string | null;
  monitorStatus: "disabled" | "idle" | "running" | "failure" | "permission";
};
export function estimateMinutes(estimate: MonitorSnapshot["estimate"]): number | null {
  return estimate && Number.isFinite(estimate.seconds) && estimate.seconds > 0
    ? Math.max(1, Math.ceil(estimate.seconds / 60))
    : null;
}
export function agentCounts(agents: MonitorSnapshot["agents"]) {
  return agents.reduce(
    (counts, agent) => {
      counts[agent.kind] += 1;
      return counts;
    },
    { monitor: 0, shell: 0, subagent: 0, background: 0 },
  );
}

/** A session as its own screen says, polled often; see `pty_standing`. */
export type Glance = {
  id: string;
  doing: "idle" | "running" | "agent" | "working";
  asking: boolean;
  said: string | null;
  /** What the shell is running, from the process table; null at a prompt or off this machine. */
  running: string | null;
};
export type ShownStatus = AgentStatus | "initial" | "idle";
/** Running and asking come off the screen; only failure needs the observer to say so. */
export function shownStatus(glance: Glance | undefined, snapshot?: MonitorSnapshot): ShownStatus {
  if (!glance) return snapshot?.status ?? "unknown";
  if (glance.asking) return "permission";
  if (glance.doing === "working" || glance.doing === "running") return "running";
  if (snapshot?.status === "failure") return "failure";
  if (!glance.said) return "initial";
  return glance.doing === "agent" ? "stopped" : "idle";
}
/** A shell running commands is summed up by what was typed, an agent by the observer. */
export function isAgent(glance: Glance | undefined) {
  return !glance || glance.asking || glance.doing === "agent" || glance.doing === "working";
}

export type Observation = { at: number; status: AgentStatus; text: string | null };
export const HISTORY_LIMIT = 30;
/** Adds a report once, newest first, keeping the same array when nothing new arrived. */
export function remember(history: Observation[], snapshot: MonitorSnapshot): Observation[] {
  if (!snapshot.updatedAt || history[0]?.at === snapshot.updatedAt) return history;
  const text = snapshot.taskSummary || snapshot.requestSummary || snapshot.error;
  return [{ at: snapshot.updatedAt, status: snapshot.status, text }, ...history].slice(
    0,
    HISTORY_LIMIT,
  );
}
