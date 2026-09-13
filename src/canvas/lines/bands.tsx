/**
 * The lines a band draws, batched into as few paths as there are ways of
 * drawing them, and the commit dots that stand on them.
 */

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

/** A run of lines drawn the same way, which is what one path is made of. */
export type Batch = { key: string; stroke: StrokeStyle; parts: GraphLine[] };

/**
 * The lines a folder draws, batched into as few paths as they are drawn ways.
 *
 * There is no band to draw these inside: a line from a folder's mark to the
 * band of a repository opened out of it belongs to neither of them, and the
 * marks and terminals down a folder's column stand on the canvas in their own
 * right. So they are drawn on the canvas itself, where every end of every one
 * of them is already in the same coordinates.
 */
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

/**
 * One repository's lines, in the band's own coordinates.
 *
 * The band itself is moved by the transform, so a repository sliding down its
 * folder's column is a different `translate` on the same paths rather than a
 * repository worked out afresh.
 */
function BandGroup({ band, standing }: { band: Band; standing: ReadonlyMap<string, XYPosition> }) {
  const at = standing.get(band.id);
  return (
    <g
      // A band being pulled open is drawn as a proposal, and the whole of it at
      // once: one class here beats a different stroke written onto each of the
      // thousand lines underneath, and the stylesheet is where what an offer
      // looks like on this canvas is already said.
      className={band.provisional ? "band-lines band-lines--provisional" : "band-lines"}
      transform={`translate(${at?.x ?? band.x} ${at?.y ?? band.y})`}
    >
      {band.lines.strokes.map((batch) => (
        <path key={batch.key} d={pathOf(batch.parts, standing)} {...stroke(batch.stroke)} />
      ))}
      {/* What joins each row to the terminals standing on it. Apart from the
          batch above because these are the one thing in a band that is not the
          repository: a terminal opening redraws these and leaves the history
          the very paths it was already drawn from. */}
      {band.runs.map((batch) => (
        <path key={batch.key} d={pathOf(batch.parts, standing)} {...stroke(batch.stroke)} />
      ))}
      {band.lines.named.map((line) => (
        <g key={line.id}>
          {/* The name is set along this very path, so it needs one of its own to
              be pointed at — which is why a named line is the one kind that is
              not batched with its neighbours. */}
          <path id={line.id} d={pathOf([line], standing)} {...stroke(line.stroke)} />
          {line.name?.note && (
            /* What the branch is to the repository, riding the same curve a
               line above the name: it ends where the name ends, so the two
               read as one block set against the head. */
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

/**
 * A repository's commit marks: the whole history as one SVG path.
 *
 * Commits used to be React Flow nodes: one positioned wrapper and three spans
 * per dot. They are fixed-size circles on a grid, so the engine can draw them
 * as pieces of one path instead. The logical nodes remain in the graph for
 * navigation, animation and actions; only their DOM disappeared.
 *
 * One path rather than one per lane, because every mark on the canvas is the
 * one ink: the dots were batched by colour while a lane lent them a hue, and a
 * repository is a path and a half now however many lines run through it. The
 * colours are the stylesheet's — see `.commit-dots`.
 */
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
    // A commit with both has nothing to say twice: the solid stub already says
    // that the line goes on past the mark.
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

/** Where a commit is standing inside its repository band. */
export function commitAt(dot: CommitDot, standing: ReadonlyMap<string, XYPosition>): Point {
  const at = standing.get(dot.node.id);
  return at ? { x: at.x + COMMIT_STEP.x / 2, y: at.y + COMMIT_STEP.y / 2 } : dot.at;
}

/** How far back a boundary commit's stub reaches: history that is not there. */
const BOUNDARY_STUB = COMMIT_STEP.x * 0.3;
/**
 * How far back the stub on a commit whose parent is only folded away reaches.
 *
 * Longer than the boundary's, and still well short of the next mark along: the
 * gap it stands in is a whole column, and a stub that only just left the dot
 * would read as a line that gave up rather than as one that was put away.
 */
const FOLDED_STUB = COMMIT_STEP.x * 0.45;

/** The short line showing that history continues past a commit's own mark. */
function stubsOf(points: readonly Point[], reach: number): string {
  let path = "";
  for (const point of points) path += `M ${point.x} ${point.y} H ${point.x - reach} `;
  return path;
}
