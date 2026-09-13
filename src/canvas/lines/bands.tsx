import type { XYPosition } from "@xyflow/react";
import { memo } from "react";
import {
  type Band,
  COMMIT_STEP,
  circlesOf,
  DOT_SIZE,
  type GraphLine,
  type Point,
  type StrokeStyle,
} from "../../lib/graph";
import { pathOf, stroke } from "./path";

export type Batch = { key: string; stroke: StrokeStyle; parts: GraphLine[] };

export const Reach = memo(function Reach({
  reach,
  standing,
}: {
  reach: readonly Batch[];
  standing: ReadonlyMap<string, XYPosition>;
}) {
  return (
    <>
      {reach.map((batch) => (
        <path
          key={batch.key}
          className="graph__reach"
          d={pathOf(batch.parts, standing)}
          {...stroke(batch.stroke)}
        />
      ))}
    </>
  );
});

export const Bands = memo(function Bands({
  bands,
  standing,
}: {
  bands: readonly Band[];
  standing: ReadonlyMap<string, XYPosition>;
}) {
  return (
    <>
      {bands.map((band) => (
        <BandGroup key={band.id} band={band} standing={standing} />
      ))}
    </>
  );
});

function BandGroup({ band, standing }: { band: Band; standing: ReadonlyMap<string, XYPosition> }) {
  const at = standing.get(band.id);
  return (
    <g
      // One class on the group beats a stroke written onto each of a thousand lines.
      className={band.provisional ? "band-lines band-lines--provisional" : "band-lines"}
      transform={`translate(${at?.x ?? band.x} ${at?.y ?? band.y})`}
    >
      {band.lines.strokes.map((batch) => (
        <path key={batch.key} d={pathOf(batch.parts, standing)} {...stroke(batch.stroke)} />
      ))}

      {band.runs.map((batch) => (
        <path key={batch.key} d={pathOf(batch.parts, standing)} {...stroke(batch.stroke)} />
      ))}
      {band.lines.named.map((line) => (
        <g key={line.id}>
          <path id={line.id} d={pathOf([line], standing)} {...stroke(line.stroke)} />
          {/* A named line keeps a path of its own for the textPath, so it is not batched. */}
          {line.name?.note && (
            <text className="edge__name edge__note" dy={-12}>
              <textPath
                href={`#${line.id}`}
                startOffset={`${line.name.at * 100}%`}
                textAnchor="end"
              >
                {line.name.note}
              </textPath>
            </text>
          )}
          {line.name && (
            <text className="edge__name" dy={-5}>
              <title>{line.name.full}</title>
              <textPath
                href={`#${line.id}`}
                startOffset={`${line.name.at * 100}%`}
                textAnchor="end"
              >
                {line.name.text}
              </textPath>
            </text>
          )}
        </g>
      ))}
      <CommitDots dots={band.lines.dots} standing={standing} />
    </g>
  );
}

export type CommitDot = Band["lines"]["dots"] extends Map<string, infer Dot> ? Dot : never;

/** The whole history as one path: commits were nodes once, and a thousand wrappers cost more than the drawing. */
function CommitDots({
  dots,
  standing,
}: {
  dots: Band["lines"]["dots"];
  standing: ReadonlyMap<string, XYPosition>;
}) {
  const marks: Point[] = [];
  const boundaries: Point[] = [];
  const folded: Point[] = [];
  for (const dot of dots.values()) {
    const at = commitAt(dot, standing);
    marks.push(at);

    if (dot.node.data.boundary) boundaries.push(at);
    else if (dot.node.data.folded) folded.push(at);
  }

  return (
    <>
      {boundaries.length > 0 && (
        <path className="commit-boundaries" d={stubsOf(boundaries, BOUNDARY_STUB)} />
      )}
      {folded.length > 0 && <path className="commit-folded" d={stubsOf(folded, FOLDED_STUB)} />}
      <path className="commit-dots" d={circlesOf(marks, DOT_SIZE / 2)} />
    </>
  );
}

export function commitAt(dot: CommitDot, standing: ReadonlyMap<string, XYPosition>): Point {
  const at = standing.get(dot.node.id);
  return at ? { x: at.x + COMMIT_STEP.x / 2, y: at.y + COMMIT_STEP.y / 2 } : dot.at;
}

const BOUNDARY_STUB = COMMIT_STEP.x * 0.3;

const FOLDED_STUB = COMMIT_STEP.x * 0.45;

function stubsOf(points: readonly Point[], reach: number): string {
  let path = "";
  for (const point of points) path += `M ${point.x} ${point.y} H ${point.x - reach} `;
  return path;
}
