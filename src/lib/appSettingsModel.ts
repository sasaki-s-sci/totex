export type AppSettings = {
  theme: "system" | "light" | "dark";
  language: "system" | "en" | "ja";
  reveal: "never" | "edge" | "centre";
  /** Whether Ctrl+Arrow, at the last terminal or group, comes round to the first. */
  walkWrap: boolean;
  follow: boolean;
  /** Whether a worktree is kept checked out ahead of time for the next branch to take. */
  spareWorktree: boolean;
  backgroundGrid: boolean;
  gridStep: number;
  gridSnap: boolean;
  /** Grid rows of air between one repository or folder and the next, measured from their outermost nodes. */
  groupGap: number;
  /** Commits a band shows from its tip; at `HISTORY_ALL` or past it, every one read. */
  historyLength: number;
  /** Whether a band is cut back to that length as commits arrive, rather than growing with them. */
  historyFollow: boolean;
  mcpServing: boolean;
  fileTitle: "name" | "path";
  readingSize: number;
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

export type SettingsPatch = Omit<Partial<AppSettings>, "said"> & {
  said?: Partial<AppSettings["said"]>;
};

/** What the backend reads of a repository unless told otherwise, so as many as there are to show. */
export const HISTORY_ALL = 300;

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  language: "system",
  reveal: "edge",
  walkWrap: true,
  follow: false,
  spareWorktree: true,
  backgroundGrid: false,
  gridStep: 24,
  gridSnap: false,
  groupGap: 2,
  historyLength: 3,
  historyFollow: false,
  mcpServing: false,
  fileTitle: "name",
  readingSize: 11,
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
  return { ...DEFAULT_SETTINGS, ...value, said: { ...DEFAULT_SETTINGS.said, ...value.said } };
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
    theme: pick("totex.mode", ["system", "light", "dark"], "system"),
    language: pick("totex.language", ["system", "en", "ja"], "system"),
    reveal: pick("totex.reveal", ["never", "edge", "centre"], "edge"),
    walkWrap: true,
    follow: read("totex.follow") === "on",
    spareWorktree: true,
    backgroundGrid: false,
    gridStep: 24,
    gridSnap: false,
    groupGap: 2,
    historyLength: 3,
    historyFollow: false,
    mcpServing: read("totex.mcp.serving") === "yes",
    fileTitle: "name",
    readingSize: number("totex.reading.size", 8, 20, 11),
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
