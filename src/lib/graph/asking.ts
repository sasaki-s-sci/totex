import type { Node } from "@xyflow/react";

import type { Ask } from "../ask";
import type { Session } from "../session";

// A question is measured here, before placement: the canvas extent and the
// stacking of two cards in one branch both need the size first.

export const ASK_WIDTH = 264;
export const ASK_WIDEST = 432;
export const ASK_GAP = 30;
export const ASK_STACK_GAP = 10;
/** Over its band, under a pinned file. */
export const ASK_Z = 1_000;

// Every number below is paired with a rule in the stylesheet.
const PAD = 9;
const HEAD = 15;
const SPLIT = 7;
const DETAIL_LINE = 13;
const QUESTION_LINE = 15;
const CHOICE_LINE = 14;
const CHOICE_PAD = 8;
const CHOICE_GAP = 4;
const FIELD_LINE = 24;
const WORK_LINE = FIELD_LINE;
const BORDER = 2;

// Widths are in terminal columns, not characters: a CJK character is two cells.
const DETAIL_CELL = 6.42;
const QUESTION_CELL = 6.78;
const CHOICE_CELL = 6.56;
const INSET = 2 * PAD + BORDER;
const CHOICE_INSET = 6 + 14 + 12;

// Only the detail is ever cut; question and answers are always drawn whole.
const DETAIL_LINES = 8;

export type CardChoice = {
  key: string;
  lines: string[];
  selected: boolean;
  /** Held by the agent, on a list that takes several. */
  picked: boolean;
};

export type AskCard = {
  detail: string[];
  question: string[];
  choices: CardChoice[];
  width: number;
  height: number;
};

export type AskNodeData = {
  session: Session;
  ask: Ask;
  card: AskCard;
};

export type AskFlowNode = Node<AskNodeData, "ask">;

export function askCard(ask: Ask): AskCard {
  const width = widthFor(ask);
  const detail = clamp(
    ask.detail.flatMap((line) => wrap(line, cellsAcross(width, DETAIL_CELL))),
    DETAIL_LINES,
  );
  const question = wrap(ask.question, cellsAcross(width, QUESTION_CELL));
  const choices = ask.choices.map((choice) => {
    const lines = wrap(choice.label, cellsAcross(width, CHOICE_CELL, CHOICE_INSET));
    return {
      key: choice.key,
      // A row being written into is drawn as a one-row field, not as text.
      lines: ask.writing && choice.selected ? [lines[0] ?? ""] : lines,
      selected: choice.selected,
      picked: choice.picked,
    };
  });

  let height = BORDER + PAD + HEAD + PAD;
  if (detail.length > 0) height += SPLIT + detail.length * DETAIL_LINE;
  if (question.length > 0) height += SPLIT + question.length * QUESTION_LINE;
  height += SPLIT;
  if (ask.taking === "words") {
    height += FIELD_LINE;
  } else {
    for (const choice of choices) {
      height += choice.lines.length * CHOICE_LINE + CHOICE_PAD;
    }
    height += Math.max(0, choices.length - 1) * CHOICE_GAP;
    if (ask.picking) height += SPLIT + WORK_LINE;
  }

  return { detail, question, choices, width, height };
}

/** The widest unbroken line wants, clamped to `ASK_WIDEST`. */
function widthFor(ask: Ask): number {
  let wanted = ASK_WIDTH;
  const room = (text: string, cell: number, inset = 0) => {
    wanted = Math.max(wanted, INSET + inset + Math.ceil(cellsOf(text.trim()) * cell));
  };

  for (const line of ask.detail) room(line, DETAIL_CELL);
  room(ask.question, QUESTION_CELL);
  for (const choice of ask.choices) room(choice.label, CHOICE_CELL, CHOICE_INSET);

  return Math.min(wanted, ASK_WIDEST);
}

function cellsAcross(width: number, cell: number, inset = 0): number {
  return Math.max(1, Math.floor((width - INSET - inset) / cell));
}

export function clamp(lines: string[], most: number): string[] {
  if (lines.length <= most) return lines;
  const kept = lines.slice(0, most);
  kept[most - 1] = `${kept[most - 1].trimEnd()}…`;
  return kept;
}

/** Breaks at spaces, and through a word where there are none. */
export function wrap(text: string, width: number): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];

  const lines: string[] = [];
  let line = "";
  let taken = 0;

  const keep = () => {
    if (line !== "") lines.push(line);
    line = "";
    taken = 0;
  };

  for (const word of trimmed.split(/\s+/)) {
    let rest = word;
    while (cellsOf(rest) > width) {
      if (taken > 0) keep();
      const [head, tail] = split(rest, width);
      lines.push(head);
      rest = tail;
    }
    const wide = cellsOf(rest);
    if (taken > 0 && taken + 1 + wide > width) keep();
    line = taken > 0 ? `${line} ${rest}` : rest;
    taken += taken > 0 ? wide + 1 : wide;
  }
  keep();

  return lines;
}

function split(word: string, width: number): [string, string] {
  let taken = 0;
  let at = 0;
  for (const letter of word) {
    const wide = cellsOf(letter);
    if (taken + wide > width) break;
    taken += wide;
    at += letter.length;
  }
  // A width under one character must still make progress through the word.
  if (at === 0) at = [...word][0]?.length ?? word.length;
  return [word.slice(0, at), word.slice(at)];
}

export function cellsOf(text: string): number {
  let cells = 0;
  for (const letter of text) cells += wide(letter) ? 2 : 1;
  return cells;
}

// Same ranges as `wide` in the Rust side's `ask/screen/grid.rs`; both count the same text.
function wide(letter: string): boolean {
  const code = letter.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f680 && code <= 0x1f6ff) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}
