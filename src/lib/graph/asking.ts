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
 * The words are broken to width here rather than where they are drawn, the way
 * a branch's name is: how big the card is has to be known before it is placed —
 * the canvas is measured from it, and two questions in one branch have to be
 * stacked clear of each other — and a box laid out from text it has not
 * measured is a box that either clips what it says or leaves a hole under it.
 *
 * What it is measured to is the whole of the question and the whole of every
 * answer. A card is the place the question is taken from, and an answer with
 * its end cut off is an answer somebody has to open the terminal to read —
 * which is the walk the card is here to save. So the size is the question's
 * rather than the card's: it is as wide as its longest line wants, up to a
 * width past which reading gets worse rather than better, and then as tall as
 * what it holds comes to at that width. Only what the question is about is
 * still cut, because that is the one part an agent can hand over a screenful
 * of.
 */

/**
 * How wide a card is at its narrowest, and how wide it may grow.
 *
 * The narrow one is a width rather than a minimum for most questions: wide
 * enough for a command, narrow enough beside a band, and the same for every
 * short question so that a column of them is a column. The wide one is where
 * growing stops being worth it — a card that goes on widening for one long
 * answer ends up a page laid over the graph, and a line of eighty columns is
 * not read more easily for being a line of a hundred and forty.
 */
export const ASK_WIDTH = 264;
export const ASK_WIDEST = 432;
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
/**
 * The row a written answer is typed into.
 *
 * One row and no more. A question that wants words wants a branch name or a
 * sentence saying what to do instead, and a card is not the place to write a
 * paragraph — the terminal it was asked in is.
 */
const FIELD_LINE = 24;
/**
 * The row under a list that is worked rather than simply answered.
 *
 * Two of them are: a list several answers are picked up from, which is not over
 * when one is pressed, and a list whose mark is standing in a row that is being
 * written at, where a key would be a letter rather than an answer. Both carry
 * the same row under the answers — the place to write, where there is one, and
 * the return that ends the question — and it is the height of a field because
 * that is what is in it.
 */
const WORK_LINE = FIELD_LINE;
/** The line round the card, and the one round each of its answers. */
const BORDER = 2;

/**
 * How wide one column of each kind of text is drawn, in canvas units.
 *
 * Columns rather than pixels because that is what the text is: what a card
 * shows came off a terminal, where a character is a cell and a Japanese
 * character is two of them. These turn the one into the other, in both
 * directions — how many columns a card of a given width holds, and how wide a
 * card would have to be to hold a given line — and they are what pairs this
 * file with the stylesheet, where the sizes themselves are.
 */
const DETAIL_CELL = 6.42;
const QUESTION_CELL = 6.78;
const CHOICE_CELL = 6.56;
/** What the card's own frame takes out of its width before any text is set. */
const INSET = 2 * PAD + BORDER;
/** And what an answer's own row takes out of that: its line, the agent's
 * column, and the padding either side of both. */
const CHOICE_INSET = BORDER + 6 + 14 + 12;

/**
 * How much of what a question is about is drawn.
 *
 * The one part of a card that is still cut, and the only part that could ever
 * want it: a tool's argument is a command, a path, or a diff, and an agent that
 * hands over a screenful of one is handing over a screenful of something the
 * terminal is still the place to read. The question and the answers are never
 * cut — a question with its end missing is a question somebody has to open the
 * terminal to finish reading, which is the walk this card exists to save. What
 * is cut is said to have been cut.
 */
const DETAIL_LINES = 8;

/** One answer, as it is drawn: its key, and its words already cut to width. */
export type CardChoice = {
  key: string;
  lines: string[];
  selected: boolean;
  /** Whether the agent is holding this one, on a list that takes several. */
  picked: boolean;
};

/** A question, measured and broken to the card it is drawn in. */
export type AskCard = {
  /** Already broken to width and cut to length, the cut marked by an ellipsis. */
  detail: string[];
  question: string[];
  choices: CardChoice[];
  /** How big the card comes out, which is what the canvas is measured from. */
  width: number;
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

/** The question as the card will draw it, and how big that makes the card. */
export function askCard(ask: Ask): AskCard {
  const width = widthFor(ask);
  const detail = clamp(
    ask.detail.flatMap((line) => wrap(line, cellsAcross(width, DETAIL_CELL))),
    DETAIL_LINES,
  );
  const question = wrap(ask.question, cellsAcross(width, QUESTION_CELL));
  const choices = ask.choices.map((choice) => ({
    key: choice.key,
    lines: wrap(choice.label, cellsAcross(width, CHOICE_CELL, CHOICE_INSET)),
    selected: choice.selected,
    picked: choice.picked,
  }));

  // The border is the card's as much as its padding is — see the stylesheet,
  // which pairs every number below with a rule.
  let height = BORDER + PAD + HEAD + PAD;
  if (detail.length > 0) height += SPLIT + detail.length * DETAIL_LINE;
  if (question.length > 0) height += SPLIT + question.length * QUESTION_LINE;
  height += SPLIT;
  if (ask.taking === "words") {
    // Nothing to press, and one place to write instead.
    height += FIELD_LINE;
  } else {
    for (const choice of choices) {
      height += choice.lines.length * CHOICE_LINE + CHOICE_PAD + BORDER;
    }
    height += Math.max(0, choices.length - 1) * CHOICE_GAP;
    // And the row that ends a list which pressing an answer does not end.
    if (ask.picking || ask.writing) height += SPLIT + WORK_LINE;
  }

  return { detail, question, choices, width, height };
}

/**
 * How wide the card is: what its longest line wants, within what a card may be.
 *
 * Every line the card will hold is asked how wide it would have to be to stand
 * unbroken, and the widest of those wins — so a question of three words is the
 * card every other question of three words is, and one with an answer a
 * sentence long is given the room to say it rather than being made to wrap it
 * five times over. Past the widest it stops asking: a line longer than that is
 * one that reads better broken than run out across the canvas, and the wrapping
 * below is what then breaks it.
 *
 * What it is about is measured with the rest of it and holds the same sway,
 * because a command is what somebody is being asked to allow: a card that fits
 * the answers and cuts the command in half has cut the half that decides.
 */
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

/** How many columns of one kind of text a card of that width holds. */
function cellsAcross(width: number, cell: number, inset = 0): number {
  return Math.max(1, Math.floor((width - INSET - inset) / cell));
}

/** As many lines as are allowed, with the last one saying there were more. */
export function clamp(lines: string[], most: number): string[] {
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
 *
 * Shared with the other card a terminal can have standing beside it — see
 * `reporting`. The two are the same card in two states, and text measured two
 * different ways would be the one thing that gave that away.
 */
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
