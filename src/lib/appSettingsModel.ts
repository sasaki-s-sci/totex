import { DEFAULT_RESUME, mergeResume, type ResumeSettings } from "../resume/model.ts";

export type MonitorFeatures = {
  status: boolean;
  agents: boolean;
  taskSummary: boolean;
  requestSummary: boolean;
  estimate: boolean;
  goal: boolean;
};
export const MONITOR_AGENTS = ["claude", "codex", "opencode", "custom"] as const;
export type MonitorAgent = (typeof MONITOR_AGENTS)[number];
export const MONITOR_PREVIEW_WIDTHS = [160, 220, 320, 420] as const;
export type MonitorPreviewWidth = (typeof MONITOR_PREVIEW_WIDTHS)[number];
export type MonitorSettings = {
  enabled: boolean;
  /** Observe only terminals running a coding agent; a plain command is not worth an observer. */
  agentsOnly: boolean;
  /** Which coding agent CLI observes the sessions; "custom" runs `command` with `args`. */
  agent: MonitorAgent;
  /** Only used when `agent` is "custom": an ACP executable and its arguments. */
  command: string;
  args: string[];
  /** Empty means the agent's own default model. */
  model: string;
  intervalSecs: number;
  features: MonitorFeatures;
  /** What the badge beside a terminal shows, among the enabled features; the popover shows all. */
  preview: MonitorFeatures;
  previewWidth: MonitorPreviewWidth;
};
export type MonitorPatch = Omit<Partial<MonitorSettings>, "features" | "preview"> & {
  features?: Partial<MonitorFeatures>;
  preview?: Partial<MonitorFeatures>;
};
export const DEFAULT_MONITOR: MonitorSettings = {
  enabled: false,
  agentsOnly: true,
  agent: "claude",
  command: "",
  args: [],
  model: "",
  intervalSecs: 30,
  features: {
    status: true,
    agents: true,
    taskSummary: true,
    requestSummary: true,
    estimate: false,
    goal: true,
  },
  preview: {
    status: true,
    agents: true,
    taskSummary: true,
    requestSummary: false,
    estimate: true,
    goal: false,
  },
  previewWidth: 220,
};
export function mergeMonitor(one: MonitorPatch | undefined, two?: MonitorPatch): MonitorSettings {
  const merged = {
    ...DEFAULT_MONITOR,
    ...one,
    ...two,
    features: { ...DEFAULT_MONITOR.features, ...one?.features, ...two?.features },
    preview: { ...DEFAULT_MONITOR.preview, ...one?.preview, ...two?.preview },
  };
  // A hand-edited or older file may name an agent this build does not know.
  if (!MONITOR_AGENTS.includes(merged.agent)) merged.agent = DEFAULT_MONITOR.agent;
  if (!MONITOR_PREVIEW_WIDTHS.includes(merged.previewWidth))
    merged.previewWidth = DEFAULT_MONITOR.previewWidth;
  return merged;
}

export type AppSettings = {
  monitor: MonitorSettings;
  /** What becomes of a job totex started when its terminal is lost; see `src/resume/model.ts`. */
  resume: ResumeSettings;
  theme: "system" | "light" | "dark";
  /** Theme ids per layer; see src/theme/declaration.ts. */
  appearance: { colors: string; style: string; effects: string };
  language: "system" | "en" | "ja";
  reveal: "never" | "edge" | "centre";
  /** Whether Ctrl+Arrow, at the last terminal or group, comes round to the first. */
  walkWrap: boolean;
  /** Where Ctrl+A puts its terminal: after the one it was pressed in, or after every other. */
  terminalSort: "createdWhere" | "createdAt";
  follow: boolean;
  /** Whether a worktree is kept checked out ahead of time for the next branch to take. */
  spareWorktree: boolean;
  backgroundGrid: boolean;
  gridStep: number;
  gridSnap: boolean;
  /** Pixels the canvas draws a terminal's mark at; see `src/canvas/markSizes.ts`. */
  cliMarkSize: number;
  /** Pixels the canvas draws a folder's mark at. */
  folderMarkSize: number;
  /** Grid rows of air between one repository or folder and the next, measured from their outermost nodes. */
  groupGap: number;
  /** What the canvas lines its groups up by: their terminal stacks, or where their histories start. */
  canvasAlign: "terminal" | "initial";
  /** Commits a band shows from its tip; at `HISTORY_ALL` or past it, every one read. */
  historyLength: number;
  /** Whether a band is cut back to that length as commits arrive, rather than growing with them. */
  historyFollow: boolean;
  mcpServing: boolean;
  fileTitle: "name" | "path";
  readingSize: number;
  /** How many steps back Ctrl+Z can take a file being edited. */
  undoDepth: number;
  /** Percent of xterm's own wheel distance. */
  cliWheel: number;
  /** Percent of d3-zoom's own wheel distance. */
  graphWheel: number;
  said: {
    showing: boolean;
    opacity: number;
    face: "terminal" | "window";
    size: number;
    lines: number;
    width: number;
    fitting: boolean;
  };
};

export type SettingsPatch = Omit<
  Partial<AppSettings>,
  "said" | "appearance" | "monitor" | "resume"
> & {
  monitor?: MonitorPatch;
  resume?: Partial<ResumeSettings>;
  said?: Partial<AppSettings["said"]>;
  appearance?: Partial<AppSettings["appearance"]>;
};

/** What the backend reads of a repository unless told otherwise, so as many as there are to show. */
export const HISTORY_ALL = 300;

export const DEFAULT_SETTINGS: AppSettings = {
  monitor: DEFAULT_MONITOR,
  resume: DEFAULT_RESUME,
  theme: "system",
  appearance: { colors: "neon", style: "default", effects: "none" },
  language: "system",
  reveal: "edge",
  walkWrap: true,
  terminalSort: "createdWhere",
  follow: false,
  spareWorktree: true,
  backgroundGrid: false,
  gridStep: 24,
  gridSnap: false,
  cliMarkSize: 11,
  folderMarkSize: 15,
  groupGap: 2,
  canvasAlign: "terminal",
  historyLength: 3,
  historyFollow: false,
  mcpServing: false,
  fileTitle: "name",
  readingSize: 11,
  undoDepth: 200,
  cliWheel: 100,
  graphWheel: 100,
  said: {
    showing: false,
    opacity: 100,
    face: "terminal",
    size: 9,
    lines: 1,
    width: 220,
    fitting: false,
  },
};

/** Unknown fields stay on disk; missing known fields take the defaults. */
export function settingsFrom(value: SettingsPatch): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    monitor: mergeMonitor(value.monitor),
    resume: mergeResume(value.resume),
    appearance: { ...DEFAULT_SETTINGS.appearance, ...value.appearance },
    said: { ...DEFAULT_SETTINGS.said, ...value.said },
  };
}

export function legacySettings(read: (key: string) => string | null): AppSettings {
  const pick = <T extends string>(key: string, choices: readonly T[], fallback: T): T =>
    choices.find((choice) => choice === read(key)) ?? fallback;
  const number = (key: string, least: number, most: number, fallback: number) => {
    const value = Number(read(key));
    return Number.isFinite(value) && value > 0
      ? Math.min(most, Math.max(least, Math.round(value)))
      : fallback;
  };
  return {
    monitor: mergeMonitor(undefined),
    resume: DEFAULT_RESUME,
    theme: pick("totex.mode", ["system", "light", "dark"], "system"),
    // `totex.preset` was a shipped id or a whole preset in JSON; only an id carries over.
    appearance: {
      ...DEFAULT_SETTINGS.appearance,
      colors: pick("totex.preset", ["neon", "classic"], "neon"),
    },
    language: pick("totex.language", ["system", "en", "ja"], "system"),
    reveal: pick("totex.reveal", ["never", "edge", "centre"], "edge"),
    walkWrap: true,
    terminalSort: "createdWhere",
    follow: read("totex.follow") === "on",
    spareWorktree: true,
    backgroundGrid: false,
    gridStep: 24,
    gridSnap: false,
    cliMarkSize: 11,
    folderMarkSize: 15,
    groupGap: 2,
    canvasAlign: "terminal",
    historyLength: 3,
    historyFollow: false,
    mcpServing: read("totex.mcp.serving") === "yes",
    fileTitle: "name",
    readingSize: number("totex.reading.size", 8, 20, 11),
    undoDepth: 200,
    cliWheel: 100,
    graphWheel: 100,
    said: {
      showing: read("totex.said") === "on",
      opacity: 100,
      face: pick("totex.said.face", ["terminal", "window"], "terminal"),
      size: number("totex.said.size", 1, 20, 9),
      lines: number("totex.said.lines", 1, 6, 1),
      width: number("totex.said.width", 80, 640, 220),
      fitting: read("totex.said.fit") === "on",
    },
  };
}
