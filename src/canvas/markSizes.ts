import { useAppSettings } from "../lib/appSettings";
import { CLI_GLYPH } from "../marks";

/**
 * Pixels the canvas draws its terminal marks at. Capped below a terminal's step, so a stack's
 * marks never run into each other; the layout does not move with them.
 */
export const CLI_MARK = { least: 8, most: 22, start: CLI_GLYPH } as const;

/** Pixels a folder's mark is drawn at on the canvas. */
export const FOLDER_MARK = { least: 10, most: 30, start: 15 } as const;

/** The room a folder's grip and close always hold, however small the mark: what a pointer needs. */
export const FOLDER_HOLD = 22;

function held(value: number, room: { least: number; most: number; start: number }): number {
  const whole = Number.isFinite(value) ? Math.round(value) : room.start;
  return Math.min(room.most, Math.max(room.least, whole));
}

export function useMarkSizes(): { cli: number; folder: number } {
  const { cliMarkSize, folderMarkSize } = useAppSettings();
  return { cli: held(cliMarkSize, CLI_MARK), folder: held(folderMarkSize, FOLDER_MARK) };
}
