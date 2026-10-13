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
