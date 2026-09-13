/**
 * What every commit says, while the keys that read the history are held.
 *
 * A commit is drawn as a dot because a history is a shape before it is a list
 * of sentences, and a canvas with a line of prose beside every mark is a canvas
 * nobody can see the shape of. But the sentence is what a commit *is*, and
 * there is no reading a history without it — so it is put on the same key that
 * walks one. Ctrl and Shift: every commit says what it is, the one the walk is
 * standing on says the whole of it, and letting go gives the shape back.
 *
 * Measured by eye rather than by the browser, the way a branch's name is: see
 * `labelOf`, which cuts names to their lines the same way and says why. Being a
 * character out only moves where a line that was going to be cut gets cut.
 */

import type { XYPosition } from "@xyflow/react";
import { memo } from "react";
import { type Band, cellsOf, clamp, DOT_SIZE, type Point, wrap } from "../../lib/graph";
import { type CommitDot, commitAt } from "./bands";

/** How far right of a dot what it says begins: clear of the mark, so the commit
 *  is read first and its words after it. */
const SAID_LEFT = DOT_SIZE / 2 + 3;
/** And how far below the line it runs on. Under the history rather than over
 *  it, where the branch names already ride. */
const SAID_DROP = 9;
/**
 * How much of a subject one commit's own column has room for, counted in the
 * columns `wrap` counts in — a wide character takes two of them.
 *
 * A commit stands a full column from the next, and what it says has to stop
 * before that one's mark: a line that ran under the neighbouring dot would be
 * two commits' words in one place.
 */
const SAID_CELLS = 24;
/** Rough advance per column at the size these are set in, which is what the
 *  ground behind a message is measured with. */
const COLUMN = 3.3;
/** The block the whole of a message is set in: how wide, how many lines of it
 *  are kept, and how far apart those lines run. */
const MESSAGE_CELLS = 44;
const MESSAGE_LINES = 12;
const MESSAGE_LINE = 8;
/** Air between the words and the edge of the ground they are set on. */
const MESSAGE_PAD = 3;
/**
 * How far a line of this size stands above its own baseline, and how far under
 * it the tails hang.
 *
 * By eye, like every other measure in here: it is what the ground has to cover
 * above the first line and under the last, and being half a pixel out shows as
 * half a pixel of air.
 */
const ASCENT = 6;
const DESCENT = 2;
/**
 * How far below the line the block hangs, which is further than a single line
 * of subject does.
 *
 * Clear of the dots: the block is as wide as what the commit says and the
 * commits along the row are a column apart, so a block set at the height of a
 * subject would have its top edge cutting the neighbouring marks in half. It
 * hangs under the whole row instead, which is also what says it is a different
 * kind of thing from the lines beside it.
 */
const MESSAGE_DROP = SAID_DROP + DOT_SIZE / 2 + 1;

/** One line of a message, and where it stands in the block. */
type Said = { at: number; text: string };

export const CommitMessages = memo(function CommitMessages({
  bands,
  standing,
  picked,
  message,
}: {
  bands: readonly Band[];
  standing: ReadonlyMap<string, XYPosition>;
  /** The commit the walk is standing on, which says more than the rest. */
  picked: string | null;
  /** And the whole of what that one says, or null while the walk is standing on
   *  something that is not a commit. */
  message: string | null;
}) {
  return (
    <>
      {bands.map((band) => (
        <BandMessages
          key={band.id}
          band={band}
          standing={standing}
          picked={picked}
          message={message}
        />
      ))}
    </>
  );
});

/**
 * One repository's history, said in words.
 *
 * In the band's own coordinates, like everything else drawn inside one: a
 * repository carried across the canvas is a different `translate` on the same
 * text rather than a line worked out again for each commit.
 */
function BandMessages({
  band,
  standing,
  picked,
  message,
}: {
  band: Band;
  standing: ReadonlyMap<string, XYPosition>;
  picked: string | null;
  message: string | null;
}) {
  const at = standing.get(band.id) ?? band;
  let reading: CommitDot | null = null;

  const subjects: { key: string; at: Point; text: string }[] = [];
  for (const dot of band.lines.dots.values()) {
    // The one the walk is standing on is not said twice: the block below has
    // the whole of what it says, and this line is the first of that.
    if (message !== null && dot.node.id === picked) {
      reading = dot;
      continue;
    }
    const text = shorten(dot.node.data.commit.subject);
    if (text !== "") subjects.push({ key: dot.node.id, at: commitAt(dot, standing), text });
  }

  return (
    <g transform={`translate(${at.x} ${at.y})`}>
      {subjects.map((said) => (
        <text
          key={said.key}
          className="commit-said"
          x={said.at.x + SAID_LEFT}
          y={said.at.y + SAID_DROP}
        >
          {said.text}
        </text>
      ))}
      {reading && message !== null && (
        <CommitReading at={commitAt(reading, standing)} message={message} />
      )}
    </g>
  );
}

/**
 * The whole of what one commit says, set as a block beside its mark.
 *
 * On a ground of its own, because this is the one thing on the canvas that is
 * paragraphs rather than a mark or a name: it runs across whatever history
 * happens to be under it, and a message read through the lines behind it is a
 * message read twice. The lines above it are cut to the width of a column and
 * left where they are — the block is what the walk is standing on, and the rest
 * of the canvas is what it is standing in.
 */
function CommitReading({ at, message }: { at: Point; message: string }) {
  const lines = blockOf(message);
  if (lines.length === 0) return null;

  const widest = lines.reduce((most, line) => Math.max(most, cellsOf(line.text)), 0);
  return (
    <g
      className="commit-reading"
      transform={`translate(${at.x + SAID_LEFT} ${at.y + MESSAGE_DROP})`}
    >
      <rect
        className="commit-reading__ground"
        x={-MESSAGE_PAD}
        y={-ASCENT - MESSAGE_PAD}
        width={widest * COLUMN + MESSAGE_PAD * 2}
        height={(lines.length - 1) * MESSAGE_LINE + ASCENT + DESCENT + MESSAGE_PAD * 2}
        rx={2}
      />
      <text className="commit-reading__said">
        {lines.map((line) => (
          <tspan key={line.at} x={0} y={line.at * MESSAGE_LINE}>
            {line.text}
          </tspan>
        ))}
      </text>
    </g>
  );
}

/**
 * A message broken into the lines the block holds.
 *
 * The message's own line breaks are kept — a commit that says one thing and
 * then lists five is a commit whose list is the point — and each of those is
 * broken again to the width of the block. A blank line stays blank, because the
 * gap under a subject is how every message ever written says where the subject
 * ended.
 */
function blockOf(message: string): Said[] {
  const lines: string[] = [];
  for (const line of message.split("\n")) {
    if (line.trim() === "") lines.push("");
    else lines.push(...wrap(line, MESSAGE_CELLS));
  }
  // A block that is only a subject has no gap to hang under it.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return clamp(lines, MESSAGE_LINES).map((text, at) => ({ at, text }));
}

/** A subject cut to what one column has room for, the cut marked as a cut. */
function shorten(subject: string): string {
  return clamp(wrap(subject, SAID_CELLS), 1)[0] ?? "";
}
