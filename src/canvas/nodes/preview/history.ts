/** What the paper held, and where its caret stood, before one change to it. */
export type Step = { text: string; caret: number | null };

/** Every change of one kind made within this long of the last is one step. */
const GROUP_MS = 1000;

/**
 * The steps Ctrl+Z walks back through and Ctrl+Shift+Z walks forward through again. Kept by the
 * card rather than the browser, whose own history is lost each time the paper is written whole.
 */
export type History = {
  back: Step[];
  ahead: Step[];
  /** The kind of the change last remembered, and when; `null` never joins a step. */
  kind: string | null;
  at: number;
};

export function newHistory(): History {
  return { back: [], ahead: [], kind: null, at: 0 };
}

/** Typing joins typing and deleting joins deleting; anything else is a step of its own. */
export function kindOf(inputType: string): string | null {
  if (inputType === "insertText" || inputType === "insertCompositionText") return "type";
  if (inputType.startsWith("delete")) return "delete";
  return null;
}

/** Called before a change, with what the paper holds until it lands. */
export function remember(
  history: History,
  step: Step,
  kind: string | null,
  now: number,
  depth: number,
): void {
  const joins = kind !== null && kind === history.kind && now - history.at < GROUP_MS;
  history.kind = kind;
  history.at = now;
  if (joins) return;
  history.ahead.length = 0;
  if (history.back.at(-1)?.text === step.text) return;
  history.back.push(step);
  if (history.back.length > depth) history.back.splice(0, history.back.length - depth);
}

/** The step to put back, with `current` kept to come forward to again; `null` with none left. */
export function stepBack(history: History, current: Step): Step | null {
  return walk(history.back, history.ahead, history, current);
}

export function stepAhead(history: History, current: Step): Step | null {
  return walk(history.ahead, history.back, history, current);
}

function walk(from: Step[], to: Step[], history: History, current: Step): Step | null {
  const step = from.pop();
  if (!step) return null;
  to.push(current);
  // What comes after a walk is never joined to what came before it.
  history.kind = null;
  return step;
}
