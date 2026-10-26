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
/** The badge shows its status as an icon, so only the rest can be previewed as text. */
export type MonitorPreview = Omit<MonitorFeatures, "status">;
/** What the badge says: the agent's own summary, the line typed at the terminal, or nothing. */
export const MONITOR_TEXTS = ["agent", "stdio", "none"] as const;
export type MonitorText = (typeof MONITOR_TEXTS)[number];
/** The model an agent starts on when it is picked; empty leaves the choice to the agent. */
export function defaultModel(agent: MonitorAgent): string {
  return agent === "claude" ? "claude-haiku-5-5" : "";
}
/** Where the observer's browser keeps its profile: one shared by every folder, or the folder's own. */
export const MONITOR_PROFILES = ["separate", "folder"] as const;
export type MonitorProfile = (typeof MONITOR_PROFILES)[number];

/** A headless browser the claude observer may look at pages with, on this machine only. */
export type MonitorBrowser = {
  enabled: boolean;
  /** The URL pattern the browser may visit; anything else is refused. */
  allowedUrl: string;
  profile: MonitorProfile;
};

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
  /** What the badge says beside a terminal; see `MonitorText`. */
  text: MonitorText;
  intervalSecs: number;
  features: MonitorFeatures;
  /** What the badge beside a terminal shows, among the enabled features; the popover shows all. */
  preview: MonitorPreview;
  /** The widest the card beside a terminal may be; its text is asked for at a length that fits. */
  previewWidth: MonitorPreviewWidth;
  browser: MonitorBrowser;
};
export type MonitorPatch = Omit<Partial<MonitorSettings>, "features" | "preview" | "browser"> & {
  features?: Partial<MonitorFeatures>;
  preview?: Partial<MonitorPreview>;
  browser?: Partial<MonitorBrowser>;
};
export const DEFAULT_MONITOR: MonitorSettings = {
  enabled: false,
  agentsOnly: true,
  agent: "claude",
  command: "",
  args: [],
  model: defaultModel("claude"),
  text: "agent",
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
    agents: true,
    taskSummary: true,
    requestSummary: true,
    estimate: true,
    goal: false,
  },
  previewWidth: 220,
  browser: { enabled: false, allowedUrl: "http://localhost:*/*", profile: "separate" },
};
/** Whether the badge shows a preview item: its feature is on and its preview is ticked. */
export function monitorShows(monitor: MonitorSettings, item: keyof MonitorPreview): boolean {
  return monitor.features[item] && monitor.preview[item];
}
/** Only the keys this build knows, so an older or hand-edited file cannot add a dead row. */
function known<T extends Record<string, boolean>>(defaults: T, values: Partial<T>): T {
  return Object.fromEntries(
    Object.keys(defaults).map((key) => [key, values[key] ?? defaults[key]]),
  ) as T;
}
export function mergeMonitor(one: MonitorPatch | undefined, two?: MonitorPatch): MonitorSettings {
  const merged = {
    ...DEFAULT_MONITOR,
    ...one,
    ...two,
    features: known(DEFAULT_MONITOR.features, { ...one?.features, ...two?.features }),
    preview: known(DEFAULT_MONITOR.preview, { ...one?.preview, ...two?.preview }),
    browser: { ...DEFAULT_MONITOR.browser, ...one?.browser, ...two?.browser },
  };
  // A hand-edited or older file may name an agent this build does not know.
  if (!MONITOR_AGENTS.includes(merged.agent)) merged.agent = DEFAULT_MONITOR.agent;
  if (!MONITOR_TEXTS.includes(merged.text)) merged.text = DEFAULT_MONITOR.text;
  if (!MONITOR_PREVIEW_WIDTHS.includes(merged.previewWidth))
    merged.previewWidth = DEFAULT_MONITOR.previewWidth;
  if (!MONITOR_PROFILES.includes(merged.browser.profile))
    merged.browser = { ...merged.browser, profile: DEFAULT_MONITOR.browser.profile };
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
  layout: "cards" | "canvas";
  /** Commits a band shows from its tip; at `HISTORY_ALL` or past it, every one read. */
  historyLength: number;
  /** Whether a band is cut back to that length as commits arrive, rather than growing with them. */
  historyFollow: boolean;
  mcpServing: boolean;
  /** Whether the left sidebar shows each terminal's CPU and memory; see `src/sidebar/left/UsagePanel.tsx`. */
  terminalUsage: boolean;
  fileTitle: "name" | "path";
  readingSize: number;
  /** How many steps back Ctrl+Z can take a file being edited. */
  undoDepth: number;
  /** Percent of xterm's own wheel distance. */
  cliWheel: number;
  /** Percent of the canvas's own wheel distance. */
  graphWheel: number;
  /** Percent of the file page's own text size, where 100 is `readingSize`. */
  pageText: number;
  /** Percent of the terminal's own text size. */
  terminalText: number;
};

export type SettingsPatch = Omit<Partial<AppSettings>, "appearance" | "monitor" | "resume"> & {
  monitor?: MonitorPatch;
  resume?: Partial<ResumeSettings>;
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
  layout: "cards",
  historyLength: 3,
  historyFollow: false,
  mcpServing: false,
  terminalUsage: false,
  fileTitle: "name",
  readingSize: 11,
  undoDepth: 200,
  cliWheel: 100,
  graphWheel: 10,
  pageText: 100,
  terminalText: 100,
};

/** Unknown fields stay on disk; missing known fields take the defaults. */
export function settingsFrom(value: SettingsPatch): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...value,
    layout: value.layout === "canvas" ? "canvas" : "cards",
    monitor: mergeMonitor(value.monitor),
    resume: mergeResume(value.resume),
    appearance: { ...DEFAULT_SETTINGS.appearance, ...value.appearance },
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
    layout: "cards",
    historyLength: 3,
    historyFollow: false,
    mcpServing: read("totex.mcp.serving") === "yes",
    terminalUsage: false,
    fileTitle: "name",
    readingSize: number("totex.reading.size", 8, 20, 11),
    undoDepth: 200,
    cliWheel: 100,
    graphWheel: 10,
    pageText: 100,
    terminalText: 100,
  };
}
