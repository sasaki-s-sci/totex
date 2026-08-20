/**
 * The coding agents a branch can be opened with.
 *
 * One entry per agent, and everything that differs between them lives here: the
 * button, the command a terminal types, and the arguments for one turn of a
 * conversation. Nothing else in the app knows any of their names.
 */

export type AgentId = "claude" | "codex" | "opencode";

export type Agent = {
  id: AgentId;
  /** What the button opens, spelled out. */
  label: string;
  colour: string;
  /** The command, as it would be typed into a shell. */
  command: string;
  /**
   * One turn of a conversation, run to completion rather than interactively.
   *
   * `first` is false once the agent has a session in this directory to carry on
   * from — the thread lives in the agent's own session store, so this is what
   * keeps the chat panel's context between messages rather than anything here.
   */
  turn: (prompt: string, first: boolean) => string[];
  /**
   * The whole command line that starts it in a terminal, with a first message
   * when the session was opened with something to do.
   *
   * Every one of these takes an opening message differently — a positional
   * argument for some, a flag for others — and this is the only place that
   * knows which. The window types the words; quoting them for whatever shell is
   * at the other end is the Rust side's business.
   */
  start: (opening: string | null) => string[];
};

export const AGENTS: Agent[] = [
  {
    id: "claude",
    label: "Claude Code",
    colour: "#d97757",
    command: "claude",
    turn: (prompt, first) => (first ? ["-p", prompt] : ["-p", "--continue", prompt]),
    // `claude [options] [command] [prompt]`: the prompt on its own starts an
    // interactive session with it already asked.
    start: (opening) => (opening ? ["claude", opening] : ["claude"]),
  },
  {
    id: "codex",
    label: "Codex",
    colour: "#10a37f",
    command: "codex",
    turn: (prompt, first) => (first ? ["exec", prompt] : ["exec", "resume", "--last", prompt]),
    // `codex [OPTIONS] [PROMPT]`, the same shape.
    start: (opening) => (opening ? ["codex", opening] : ["codex"]),
  },
  {
    id: "opencode",
    label: "opencode",
    colour: "#8b5cf6",
    command: "opencode",
    turn: (prompt, first) => (first ? ["run", prompt] : ["run", "--continue", prompt]),
    // The positional here is the project directory, not a prompt, so the
    // opening message goes on the flag instead.
    start: (opening) => (opening ? ["opencode", "--prompt", opening] : ["opencode"]),
  },
];

/**
 * Every agent's id, in the catalogue's order.
 *
 * The order is the catalogue's wherever it is asked for — what settings stores,
 * what the dialog lists, and what a branch's buttons run in are all this list.
 */
export const AGENT_IDS: AgentId[] = AGENTS.map((agent) => agent.id);

/** The agents a window has been told to show, in the catalogue's order. */
export function enabledAgents(wanted: readonly AgentId[]): Agent[] {
  return AGENTS.filter((agent) => wanted.includes(agent.id));
}

export function agentOf(id: AgentId): Agent {
  const found = AGENTS.find((agent) => agent.id === id);
  if (!found) throw new Error(`unknown agent ${id}`);
  return found;
}
