import type { Node } from "@xyflow/react";

import type { Ask } from "../ask";
import type { Session } from "../session";

/**
 * The card a question is drawn in, and the room it takes on the canvas.
 *
 * A question is the one thing on this canvas that is words rather than a mark.
 * Everything else here — a commit, a branch, a terminal — says what it is by
 * being a shape in a place, and a question cannot: what is being asked is the
 * whole of it, and it has to be read. So it is the one card the graph grows of
 * its own accord, and it is the same card every time, in the same place beside
 * the terminal it belongs to, with the answers in the same row at the foot of
 * it. Whatever the agent is asking about, the shape of being asked is constant,
 * which is what makes it recognisable from across a canvas.
 *
 * The words are cut to length here rather than where they are drawn, the way a
 * branch's name is: how tall the card is has to be known before it is placed —
 * the canvas is measured from it, and two questions in one branch have to be
 * stacked clear of each other — and a box laid out from text it has not
 * measured is a box that either clips what it says or leaves a hole under it.
 */

/** How wide a card is. Wide enough for a command, narrow enough beside a band. */
export const ASK_WIDTH = 264;
/** How far it stands from the terminal mark, leaving room for the line. */
export const ASK_GAP = 30;
/** How far apart two cards stand when one branch is asked twice at once. */
export const ASK_STACK_GAP = 10;
/**
 * The layer a card stands on.
 *
 * Over the band it belongs to and over anything drawn beside it: a question is
 * a turn nobody has taken, and it is worth more than whatever it is standing
 * over for as long as it is up. Under a file somebody pinned, which is the one
 * thing on this canvas that was put there by hand.
 */
export const ASK_Z = 1_000;

/** The card's own inset, and the parts it is built from, in canvas units. */
const PAD = 9;
const HEAD = 15;
const SPLIT = 7;
const DETAIL_LINE = 13;
const QUESTION_LINE = 15;
const CHOICE_LINE = 14;
const CHOICE_PAD = 8;
const CHOICE_GAP = 4;
/** The line round the card, and the one round each of its answers. */
const BORDER = 2;

/**
 * How many columns of each kind of text a card holds.
 *
 * Columns rather than pixels because that is what the text is: what a card
 * shows came off a terminal, where a character is a cell and a Japanese
 * character is two of them. The numbers are the card's inner width divided by
 * how wide a character is drawn at each size — see the stylesheet, which is
 * where the sizes themselves are.
 */
const DETAIL_CELLS = 38;
const QUESTION_CELLS = 36;
const CHOICE_CELLS = 32;

/**
 * How much of each part is drawn.
 *
 * A card is a question, not a document: what is being asked about is a tool and
 * its argument, and an agent that hands over a screenful of it is handing over
 * a screenful of something the terminal is still the place to read. What is cut
 * is said to have been cut.
 */
const DETAIL_LINES = 4;
const QUESTION_LINES = 3;
const CHOICE_WRAP = 2;

/** One answer, as it is drawn: its number, and its words already cut to width. */
export type CardChoice = {
  key: string;
  lines: string[];
  selected: boolean;
};

/** A question, measured and cut to the card it is drawn in. */
export type AskCard = {
  /** Already broken to width and cut to length, the cut marked by an ellipsis. */
  detail: string[];
  question: string[];
  choices: CardChoice[];
  /** How tall the card comes out, which is what the canvas is measured from. */
  height: number;
};

export type AskNodeData = {
  /** The session being asked, which is what an answer is addressed to. */
  session: Session;
  /** The question itself, whose number goes back with the answer. */
  ask: Ask;
  card: AskCard;
};

export type AskFlowNode = Node<AskNodeData, "ask">;

/** The question as the card will draw it, and how tall that makes the card. */
export function askCard(ask: Ask): AskCard {
  const detail = clamp(
    ask.detail.flatMap((line) => wrap(line, DETAIL_CELLS)),
    DETAIL_LINES,
  );
  const question = clamp(wrap(ask.question, QUESTION_CELLS), QUESTION_LINES);
  const choices = ask.choices.map((choice) => ({
    key: choice.key,
    lines: clamp(wrap(choice.label, CHOICE_CELLS), CHOICE_WRAP),
    selected: choice.selected,
  }));

  // The border is the card's as much as its padding is — see the stylesheet,
  // which pairs every number below with a rule.
  let height = BORDER + PAD + HEAD + PAD;
  if (detail.length > 0) height += SPLIT + detail.length * DETAIL_LINE;
  if (question.length > 0) height += SPLIT + question.length * QUESTION_LINE;
  height += SPLIT;
  for (const choice of choices) {
    height += choice.lines.length * CHOICE_LINE + CHOICE_PAD + BORDER;
  }
  height += Math.max(0, choices.length - 1) * CHOICE_GAP;

  return { detail, question, choices, height };
}

/** As many lines as are allowed, with the last one saying there were more. */
function clamp(lines: string[], most: number): string[] {
  if (lines.length <= most) return lines;
  const kept = lines.slice(0, most);
  kept[most - 1] = `${kept[most - 1].trimEnd()}…`;
  return kept;
}

/**
 * One line of text broken to a width, in columns rather than characters.
 *
 * Broken at the spaces where there are any, and through the middle of a word
 * where there are none — which is most of what a card shows, because a path and
 * a command are one word each and both of them are longer than the card.
 */
function wrap(text: string, width: number): string[] {
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
    // A word wider than the card is cut where the card ends, however many
    // pieces that takes.
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

/** The first `width` columns of a word, and whatever is left of it. */
function split(word: string, width: number): [string, string] {
  let taken = 0;
  let at = 0;
  for (const letter of word) {
    const wide = cellsOf(letter);
    if (taken + wide > width) break;
    taken += wide;
    at += letter.length;
  }
  // A card narrower than one character would otherwise never get through the
  // word at all.
  if (at === 0) at = [...word][0]?.length ?? word.length;
  return [word.slice(0, at), word.slice(at)];
}

/** How many columns a run of text takes. */
function cellsOf(text: string): number {
  let cells = 0;
  for (const letter of text) cells += wide(letter) ? 2 : 1;
  return cells;
}

/**
 * Whether a character is drawn two columns wide.
 *
 * The same ranges the Rust side reads the screen with — see `wide` in `ask.rs`.
 * They have to agree: one counts the columns a box was drawn in and the other
 * counts the columns a card has room for, and the text is the same text.
 */
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
