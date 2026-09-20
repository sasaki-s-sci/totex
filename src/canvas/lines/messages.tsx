import type { XYPosition } from "@xyflow/react";
import { memo } from "react";
import { type Band, clamp, DOT_SIZE, type Point, wrap } from "../../lib/graph";
import { commitAt } from "./bands";

const SAID_LEFT = DOT_SIZE / 2 + 3;

const SAID_DROP = 9;

const SAID_CELLS = 24;

export const CommitMessages = memo(function CommitMessages({
  bands,
  standing,
}: {
  bands: readonly Band[];
  standing: ReadonlyMap<string, XYPosition>;
}) {
  return (
    <>
      {bands.map((band) => (
        <BandMessages key={band.id} band={band} standing={standing} />
      ))}
    </>
  );
});

function BandMessages({
  band,
  standing,
}: {
  band: Band;
  standing: ReadonlyMap<string, XYPosition>;
}) {
  const at = standing.get(band.id) ?? band;

  const subjects: { key: string; at: Point; text: string }[] = [];
  for (const dot of band.lines.dots.values()) {
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
    </g>
  );
}

function shorten(subject: string): string {
  return clamp(wrap(subject, SAID_CELLS), 1)[0] ?? "";
}
