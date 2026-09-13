import type { XYPosition } from "@xyflow/react";
import { memo } from "react";
import { type Band, cellsOf, clamp, DOT_SIZE, type Point, wrap } from "../../lib/graph";
import { type CommitDot, commitAt } from "./bands";

const SAID_LEFT = DOT_SIZE / 2 + 3;

const SAID_DROP = 9;

const SAID_CELLS = 24;

const COLUMN = 3.3;

const MESSAGE_CELLS = 44;
const MESSAGE_LINES = 12;
const MESSAGE_LINE = 8;

const MESSAGE_PAD = 3;

const ASCENT = 6;
const DESCENT = 2;

const MESSAGE_DROP = SAID_DROP + DOT_SIZE / 2 + 1;

type Said = { at: number; text: string };

export const CommitMessages = memo(function CommitMessages({
  bands,
  standing,
  picked,
  message,
}: {
  bands: readonly Band[];
  standing: ReadonlyMap<string, XYPosition>;

  picked: string | null;

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

function blockOf(message: string): Said[] {
  const lines: string[] = [];
  for (const line of message.split("\n")) {
    if (line.trim() === "") lines.push("");
    else lines.push(...wrap(line, MESSAGE_CELLS));
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return clamp(lines, MESSAGE_LINES).map((text, at) => ({ at, text }));
}

function shorten(subject: string): string {
  return clamp(wrap(subject, SAID_CELLS), 1)[0] ?? "";
}
