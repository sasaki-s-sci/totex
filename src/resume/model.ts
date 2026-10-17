/**
 * What a job totex started is, and what to do about one that was lost.
 *
 * A job is a line totex typed into a terminal of its own: a coding agent, or a command the space
 * keeps with a `# resume:` line above it. Only those: a line somebody typed themselves is not one
 * this window can say anything true about, since what a terminal is running is not something the
 * machine will tell — see `src-tauri/src/ask/doing.rs`.
 *
 * A job is lost three ways. A program update that replaces the service closes every terminal; a
 * terminal closed from the window takes its job with it; and anything else that ends a shell under
 * a running job — the service or the machine going down — is a crash. Each of the three has its
 * own answer: run the job again on its own, offer to, or let it go.
 */

export type Mode = "auto" | "ask" | "off";
export type Why = "update" | "crash" | "close";
export const WHYS: readonly Why[] = ["update", "crash", "close"];
export const MODES: readonly Mode[] = ["auto", "ask", "off"];

/**
 * What says the world a job was running in is still the one it would come back to. `git` is the
 * checkout's HEAD and every change in it; `cmd:<line>` is whatever that line prints, run in the
 * job's directory; `none` takes the world on trust.
 */
export type Guard = "git" | "none" | `cmd:${string}`;

export type Policy = {
  update: Mode;
  crash: Mode;
  close: Mode;
  /** Seconds since the job was last seen running, past which it is no longer run on its own. */
  within: number;
  guard: Guard;
};

export type ResumeSettings = Policy & {
  /** Sent to an agent that was in the middle of a turn, so the turn is taken up again. */
  prompt: string;
  /** The line each agent is started with from the task menu. */
  agents: Record<Agent, string>;
};

export const AGENTS = ["claude", "codex", "opencode"] as const;
export type Agent = (typeof AGENTS)[number];

export const DEFAULT_RESUME: ResumeSettings = {
  update: "auto",
  crash: "ask",
  close: "ask",
  within: 600,
  guard: "git",
  prompt: "You were interrupted. Continue the task you were working on.",
  agents: { claude: "claude", codex: "codex", opencode: "opencode" },
};

export const WITHIN = { least: 10, most: 86_400 } as const;

export function mergeResume(value: unknown): ResumeSettings {
  const given = value && typeof value === "object" ? (value as Partial<ResumeSettings>) : {};
  const merged: ResumeSettings = {
    ...DEFAULT_RESUME,
    ...given,
    agents: { ...DEFAULT_RESUME.agents, ...given.agents },
  };
  // A hand-edited file may say anything; what this build cannot read falls back.
  for (const why of WHYS) if (!MODES.includes(merged[why])) merged[why] = DEFAULT_RESUME[why];
  if (!isGuard(merged.guard)) merged.guard = DEFAULT_RESUME.guard;
  merged.within = clampWithin(merged.within);
  if (typeof merged.prompt !== "string") merged.prompt = DEFAULT_RESUME.prompt;
  for (const agent of AGENTS) {
    if (typeof merged.agents[agent] !== "string" || !merged.agents[agent].trim())
      merged.agents[agent] = DEFAULT_RESUME.agents[agent];
  }
  return merged;
}

function isGuard(value: unknown): value is Guard {
  return (
    value === "git" || value === "none" || (typeof value === "string" && value.startsWith("cmd:"))
  );
}

function clampWithin(value: unknown): number {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return DEFAULT_RESUME.within;
  return Math.min(WITHIN.most, Math.max(WITHIN.least, Math.round(seconds)));
}

export function policyOf(settings: ResumeSettings): Policy {
  const { update, crash, close, within, guard } = settings;
  return { update, crash, close, within, guard };
}

/**
 * A `# resume:` line, read over the defaults: `update=auto crash=ask close=off within=300
 * guard=git`. A guard command is the rest of the line, spaces and all, so `guard=cmd:` goes last.
 * A word this cannot read is passed over rather than refusing the whole line: the line still says
 * the job is one to keep.
 */
export function parsePolicy(spec: string, base: Policy): Policy {
  const policy = { ...base };
  let rest = spec.trim();
  while (rest) {
    if (rest.startsWith("guard=cmd:")) {
      const line = rest.slice("guard=cmd:".length).trim();
      if (line) policy.guard = `cmd:${line}`;
      break;
    }
    const space = rest.search(/\s/);
    const word = space < 0 ? rest : rest.slice(0, space);
    rest = space < 0 ? "" : rest.slice(space).trim();
    const [key, value] = word.split("=", 2);
    if (key === "within") policy.within = clampWithin(value);
    else if (key === "guard" && (value === "git" || value === "none")) policy.guard = value;
    else if (
      (WHYS as readonly string[]).includes(key) &&
      (MODES as readonly string[]).includes(value)
    )
      policy[key as Why] = value as Mode;
  }
  return policy;
}

/** One word of a command line as it was typed, and what the shell would read it as. */
type Word = { raw: string; text: string };

/** POSIX words, kept as typed so a line put back together reads the way it was written. */
export function words(line: string): Word[] {
  const found: Word[] = [];
  let at = 0;
  while (at < line.length) {
    while (at < line.length && /\s/.test(line[at])) at += 1;
    if (at >= line.length) break;
    const start = at;
    let text = "";
    while (at < line.length && !/\s/.test(line[at])) {
      const char = line[at];
      if (char === "'") {
        const end = line.indexOf("'", at + 1);
        const close = end < 0 ? line.length : end;
        text += line.slice(at + 1, close);
        at = close + 1;
      } else if (char === '"') {
        at += 1;
        while (at < line.length && line[at] !== '"') {
          if (line[at] === "\\" && at + 1 < line.length) at += 1;
          text += line[at];
          at += 1;
        }
        at += 1;
      } else if (char === "\\" && at + 1 < line.length) {
        text += line[at + 1];
        at += 2;
      } else {
        text += char;
        at += 1;
      }
    }
    found.push({ raw: line.slice(start, Math.min(at, line.length)), text });
  }
  return found;
}

/** Single quotes, which every shell totex opens a terminal to reads the same way. */
export function quote(text: string): string {
  return /^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

/** The agent a line starts, by the program it names first: `X=1 claude -c` is claude. */
export function agentOf(line: string): Agent | null {
  if (line.includes("\n")) return null;
  const first = words(line).find((word) => !/^\w+=/.test(word.text));
  if (!first) return null;
  const name = first.text
    .split(/[\\/]/)
    .pop()
    ?.replace(/\.(exe|cmd|bat|ps1)$/i, "");
  return (AGENTS as readonly string[]).includes(name ?? "") ? (name as Agent) : null;
}

/**
 * Options that take the next word as their value, per agent. Everything else that starts with a
 * dash is taken to stand alone, and a word that is neither is the prompt the agent was started
 * with, which a resumed conversation must not be sent again.
 */
const VALUED: Record<Agent, ReadonlySet<string>> = {
  claude: new Set([
    "--model",
    "--permission-mode",
    "--add-dir",
    "--allowedTools",
    "--allowed-tools",
    "--disallowedTools",
    "--disallowed-tools",
    "--settings",
    "--setting-sources",
    "--agent",
    "--agents",
    "--mcp-config",
    "--append-system-prompt",
    "--system-prompt",
    "--fallback-model",
    "--effort",
    "--output-format",
    "--input-format",
    "--name",
    "--session-id",
    "-r",
    "--resume",
  ]),
  codex: new Set([
    "-m",
    "--model",
    "-c",
    "--config",
    "-p",
    "--profile",
    "-s",
    "--sandbox",
    "-a",
    "--ask-for-approval",
    "-C",
    "--cd",
    "--add-dir",
    "-i",
    "--image",
    "--enable",
    "--disable",
    "--local-provider",
  ]),
  opencode: new Set(["-m", "--model", "--agent", "-s", "--session", "--prompt", "--port"]),
};

/** What says, in a line as typed, which conversation it is. */
const NAMING: Record<Agent, readonly string[]> = {
  claude: ["--session-id", "--resume", "-r"],
  codex: [],
  opencode: ["-s", "--session"],
};

/** What, in a line as typed, picks up an earlier conversation without naming it. */
const CONTINUING: Record<Agent, readonly string[]> = {
  claude: ["--continue", "-c"],
  codex: [],
  opencode: ["--continue", "-c"],
};

/** What, in a line as typed, was said to the agent once and must not be said again. */
const SAYING: Record<Agent, readonly string[]> = {
  claude: [],
  codex: [],
  opencode: ["--prompt"],
};

type Split = {
  program: Word;
  /** Assignments before the program, kept as typed. */
  before: Word[];
  options: Word[];
  session: string | null;
  /** `codex resume`: the conversation is the first word after it. */
  resuming: boolean;
};

function split(line: string, agent: Agent): Split | null {
  const all = words(line);
  const at = all.findIndex((word) => !/^\w+=/.test(word.text));
  if (at < 0) return null;
  const before = all.slice(0, at);
  const program = all[at];
  let rest = all.slice(at + 1);
  let resuming = false;
  let session: string | null = null;
  if (agent === "codex" && rest[0]?.text === "resume") {
    resuming = true;
    rest = rest.slice(1);
  }
  const options: Word[] = [];
  for (let index = 0; index < rest.length; index += 1) {
    const word = rest[index];
    const [flag, inline] = word.text.split("=", 2);
    if (NAMING[agent].includes(flag)) {
      const value = inline ?? rest[index + 1]?.text;
      if (inline === undefined) index += 1;
      if (value && !value.startsWith("-")) session = value;
      continue;
    }
    if (SAYING[agent].includes(flag)) {
      if (inline === undefined) index += 1;
      continue;
    }
    if (CONTINUING[agent].includes(word.text)) continue;
    if (word.text.startsWith("-")) {
      options.push(word);
      if (inline === undefined && VALUED[agent].has(flag) && rest[index + 1]) {
        options.push(rest[index + 1]);
        index += 1;
      }
      continue;
    }
    if (resuming && session === null && word.text !== "--last") session = word.text;
  }
  return { program, before, options, session, resuming };
}

export type Launch = {
  /** What is typed into the terminal. */
  line: string;
  /** The conversation it is, where the line says so or totex chose it. */
  session: string | null;
};

/**
 * The line to start a job with. Claude is handed the id of its conversation up front, so there is
 * never any question which one to resume; codex and opencode choose their own, which is found
 * afterwards — see `resume_codex_sessions`.
 */
export function launchLine(line: string, newId: () => string): Launch {
  const agent = agentOf(line);
  if (!agent) return { line, session: null };
  const parts = split(line, agent);
  if (!parts) return { line, session: null };
  if (parts.session) return { line, session: parts.session };
  const continuing = words(line).some((word) => CONTINUING[agent].includes(word.text));
  if (agent !== "claude" || continuing) return { line, session: null };
  const id = newId();
  const at = line.indexOf(parts.program.raw) + parts.program.raw.length;
  return { line: `${line.slice(0, at)} --session-id ${id}${line.slice(at)}`, session: id };
}

/**
 * The line that takes a lost job up again. A command is run again as it was. An agent is started on
 * the same conversation with the options it was started with, and without the prompt it was started
 * with — that was answered — but with `prompt` instead when it was lost in the middle of a turn.
 */
export function resumeLine(
  job: Pick<Job, "line" | "agent" | "session">,
  prompt: string | null,
): string {
  if (!job.agent) return job.line;
  const parts = split(job.line, job.agent);
  if (!parts) return job.line;
  const session = job.session ?? parts.session;
  const head = [...parts.before, parts.program].map((word) => word.raw);
  const options = parts.options.map((word) => word.raw);
  const asked = prompt?.trim() ? quote(prompt.trim()) : null;
  const line = (() => {
    switch (job.agent) {
      case "claude":
        return [...head, ...options, ...(session ? ["--resume", session] : ["--continue"])];
      case "codex":
        return [...head, "resume", ...options, session ?? "--last"];
      case "opencode":
        return [
          ...head,
          ...options,
          ...(session ? ["--session", session] : ["--continue"]),
          ...(asked ? ["--prompt"] : []),
        ];
    }
  })();
  if (asked) line.push(asked);
  return line.join(" ");
}

export type Lost = { why: Why; at: number };

export type Job = {
  /** The terminal it runs in. */
  id: string;
  cwd: string;
  branch: string;
  folder?: boolean;
  /** As it was typed in, with whatever totex added to it. */
  line: string;
  agent: Agent | null;
  /** The agent's own conversation, once known. */
  session: string | null;
  policy: Policy;
  startedAt: number;
  /** When it was last seen running. */
  seenAt: number;
  /** Whether it has been seen running at all: the shell is at its prompt before it starts. */
  running: boolean;
  /** Whether the agent was in the middle of a turn when last seen. */
  working: boolean;
  fingerprint: string | null;
  lost: Lost | null;
};

export type Doubt = "stale" | "changed" | "unchecked";

export type Verdict = { act: "auto" | "ask" | "drop"; doubts: Doubt[] };

/**
 * What to do about a lost job. `now` is what the job's guard says of the world as it stands: a
 * fingerprint, `null` where the guard has nothing to say, `"missing"` where the job's directory is
 * gone, and `"failed"` where the guard could not be asked. Anything in doubt is offered rather than
 * run: a run nobody asked for, against a world that has moved, is the one outcome that cannot be
 * taken back.
 */
export function verdict(
  job: Pick<Job, "lost" | "policy" | "seenAt" | "fingerprint">,
  at: number,
  now: string | null | "missing" | "failed",
): Verdict {
  const why = job.lost?.why ?? "crash";
  const mode = job.policy[why];
  if (mode === "off" || now === "missing") return { act: "drop", doubts: [] };
  const stale = at - job.seenAt > job.policy.within * 1000;
  // A closed terminal is offered for as long as `within` and no longer: that one was asked for.
  if (why === "close" && stale) return { act: "drop", doubts: [] };
  const doubts: Doubt[] = [];
  if (stale) doubts.push("stale");
  if (now === "failed") doubts.push("unchecked");
  else if (job.fingerprint !== null && now !== job.fingerprint) doubts.push("changed");
  return { act: mode === "auto" && doubts.length === 0 ? "auto" : "ask", doubts };
}

/** The document the jobs are kept in, in the service's store. */
export const KEPT = "totex.resume";

export function readJobs(kept: unknown): Job[] {
  if (!kept || typeof kept !== "object") return [];
  const jobs = (kept as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) return [];
  return jobs.filter(
    (job): job is Job =>
      !!job &&
      typeof job === "object" &&
      typeof job.id === "string" &&
      typeof job.cwd === "string" &&
      typeof job.line === "string" &&
      !!job.policy &&
      typeof job.policy === "object",
  );
}
