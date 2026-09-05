/** The editable preferences stored in ~/.totex/totex.json. */
export type AppSettings = {
  theme: "system" | "light" | "dark";
  language: "system" | "en" | "ja";
  reveal: "never" | "edge" | "centre";
  follow: boolean;
  mcpServing: boolean;
  fileTitle: "name" | "path";
  readingSize: number;
  said: {
    showing: boolean;
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

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  language: "system",
  reveal: "edge",
  follow: false,
  mcpServing: false,
  fileTitle: "name",
  readingSize: 11,
  said: { showing: false, face: "terminal", size: 9, lines: 1, width: 220, fitting: false },
};

/** Unknown fields remain on disk; missing known fields use the app defaults. */
export function settingsFrom(value: SettingsPatch): AppSettings {
  return { ...DEFAULT_SETTINGS, ...value, said: { ...DEFAULT_SETTINGS.said, ...value.said } };
}

/** Used only when the JSON file does not exist yet. */
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
    follow: read("totex.follow") === "on",
    mcpServing: read("totex.mcp.serving") === "yes",
    fileTitle: "name",
    readingSize: number("totex.reading.size", 8, 20, 11),
    said: {
      showing: read("totex.said") === "on",
      face: pick("totex.said.face", ["terminal", "window"], "terminal"),
      size: number("totex.said.size", 1, 20, 9),
      lines: number("totex.said.lines", 1, 6, 1),
      width: number("totex.said.width", 80, 640, 220),
      fitting: read("totex.said.fit") === "on",
    },
  };
}
