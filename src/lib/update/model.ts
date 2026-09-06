/** Persistent owns state and effects; ephemeral owns compatible rendering expressions and styles. */
export type Layer = "persistent" | "ephemeral";
export type UpdateStage = "rest" | "taking" | "current" | "ready" | "swapped" | "held" | "failed";
export type Rung = {
  layer: Layer;
  at: string;
  can: boolean;
  picked: string | null;
  frontContract: number | null;
  ephemeralContract: string;
  held: string[];
};
export type UpdateChoice = {
  version: string;
  frontContract: number | null;
  ephemeralContract: string | null;
  persistentAvailable: boolean;
};
export type Press = { stage: UpdateStage; progress: number | null; version: string | null };
export type UpdateState = {
  rungs: Rung[] | null;
  versions: string[];
  choices: UpdateChoice[];
  presses: Record<Layer, Press>;
};
