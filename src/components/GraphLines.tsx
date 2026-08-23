import { useReactFlow, useStoreApi, ViewportPortal, type XYPosition } from "@xyflow/react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  type AppNode,
  type Band,
  COLUMN_WIDTH,
  type CommitFlowNode,
  circlesOf,
  DOT_SIZE,
  distanceTo,
  type FoldTarget,
  foldCell,
  type GraphLine,
  LANE_HEIGHT,
  type LineEnd,
  type Point,
  STEP,
  type StrokeStyle,
  shortOf,
  sigmoidPath,
  straightPath,
} from "../lib/graph";
import { useGraphActions } from "./graphActions";

/**
 * Every line on the canvas, drawn as a handful of paths.
 *
 * History is lines, and there are as many of them as there are commits — the
 * canvas routinely holds a thousand. Given to the engine one element apiece
 * they were the greater part of what a frame cost, so they are batched instead:
 * every line a band draws the same way is one path with a piece per line, and a
 * repository comes to about a dozen elements however long its history is.
 *
 * The band's own lines are worked out once and held in its own coordinates, so
 * the packing moving a repository is a different `translate` on the same paths.
 *
 * Nothing here takes the pointer. What a line offers is drawn only while the
 * cursor is on it, by `Hover`, which finds the line by arithmetic rather than
 * by asking the engine to hit-test a thousand of them.
 */
export const GraphLines = memo(function GraphLines({
  bands,
  reach,
  extent,
  nodes,
  selected,
  picked,
  onCommit,
}: {
  bands: readonly Band[];
  /** The terminals in the last column, each a line to the row it runs in. */
  reach: readonly Batch[];
  /**
   * The box the lines are drawn in, which is as big as everything reaches.
   *
   * Handed over rather than worked out here: an SVG root clips to its own box
   * whatever it is told about overflow, and what hangs lowest on the canvas is
   * a band of places the repositories know nothing about.
   */
  extent: { width: number; height: number };
  nodes: readonly AppNode[];
  selected: string | null;
  picked: string | null;
  onCommit: (node: CommitFlowNode, at: { x: number; y: number }) => void;
}) {
  // Where every mark is standing, which is where the lines into it are drawn
  // from. The canvas's own copy rather than the layout's: a repository laid out
  // again walks its commits to their new places over a few frames, and the
  // lines have to walk with them.
  const standing = useMemo(() => {
    const places = new Map<string, XYPosition>();
    for (const node of nodes) places.set(node.id, node.position);
    return places;
  }, [nodes]);

  return (
    <ViewportPortal>
      <svg className="graph__lines" width={extent.width} height={extent.height} aria-hidden="true">
        {/* Under the history, and drawn on the canvas rather than in any band:
            these are the one kind of line that runs from one repository to
            another, and what they cross is not theirs to obscure. */}
        <Reach reach={reach} standing={standing} />
        <Bands bands={bands} standing={standing} />
        <CommitEmphasis bands={bands} standing={standing} selected={selected} picked={picked} />
        <Hover bands={bands} standing={standing} onCommit={onCommit} />
      </svg>
    </ViewportPortal>
  );
});

/** A run of lines drawn the same way, which is what one path is made of. */
type Batch = { key: string; stroke: StrokeStyle; parts: GraphLine[] };

/**
 * The lines out of the last column, batched into as few paths as they are
 * drawn ways.
 *
 * There is no band to draw these inside: a line from the column of terminals to
 * a row in a repository belongs to neither of them, and the rows they end in
 * are in different bands. So they are drawn on the canvas itself, where both
 * ends of a line are already in the same coordinates — a band's position and a
 * terminal's are both the canvas's own.
 */
const Reach = memo(function Reach({
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

const Bands = memo(function Bands({
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
 * The band itself is moved by the transform, so the packing sliding a
 * repository along the row is a different `translate` on the same paths rather
 * than a repository worked out afresh.
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

type CommitDot = Band["lines"]["dots"] extends Map<string, infer Dot> ? Dot : never;

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
function commitAt(dot: CommitDot, standing: ReadonlyMap<string, XYPosition>): Point {
  const at = standing.get(dot.node.id);
  return at ? { x: at.x + COLUMN_WIDTH / 2, y: at.y + LANE_HEIGHT / 2 } : dot.at;
}

/** How far back a boundary commit's stub reaches: history that is not there. */
const BOUNDARY_STUB = COLUMN_WIDTH * 0.3;
/**
 * How far back the stub on a commit whose parent is only folded away reaches.
 *
 * Longer than the boundary's, and still well short of the next mark along: the
 * gap it stands in is a whole column, and a stub that only just left the dot
 * would read as a line that gave up rather than as one that was put away.
 */
const FOLDED_STUB = COLUMN_WIDTH * 0.45;

/** The short line showing that history continues past a commit's own mark. */
function stubsOf(points: readonly Point[], reach: number): string {
  let path = "";
  for (const point of points) path += `M ${point.x} ${point.y} H ${point.x - reach} `;
  return path;
}

/** Selection and keyboard focus are the only commit marks not shared in a batch. */
function CommitEmphasis({
  bands,
  standing,
  selected,
  picked,
}: {
  bands: readonly Band[];
  standing: ReadonlyMap<string, XYPosition>;
  selected: string | null;
  picked: string | null;
}) {
  if (!selected && !picked) return null;

  const marks: { band: Band; dot: CommitDot; selected: boolean; picked: boolean }[] = [];
  for (const band of bands) {
    for (const dot of band.lines.dots.values()) {
      const isSelected = dot.node.id === selected;
      const isPicked = dot.node.id === picked;
      if (isSelected || isPicked) marks.push({ band, dot, selected: isSelected, picked: isPicked });
    }
  }

  return (
    <>
      {marks.map((mark) => {
        const bandAt = standing.get(mark.band.id) ?? mark.band;
        const at = commitAt(mark.dot, standing);
        return (
          <g key={mark.dot.node.id} transform={`translate(${bandAt.x} ${bandAt.y})`}>
            {mark.picked && (
              <rect
                className="commit-pick"
                x={at.x - COLUMN_WIDTH / 2}
                y={at.y - LANE_HEIGHT / 2}
                width={COLUMN_WIDTH}
                height={LANE_HEIGHT}
                rx={6}
              />
            )}
            {mark.selected && (
              <circle className="commit-selection" cx={at.x} cy={at.y} r={HALO_RADIUS} />
            )}
          </g>
        );
      })}
    </>
  );
}

/**
 * A run of lines as one piece of path data.
 *
 * Every line drawn the same way is a piece of the same path, which is what
 * makes a repository a dozen elements instead of one per commit. A line whose
 * ends are not both on the canvas is left out rather than drawn to nowhere.
 *
 * Both ends are pulled back off the marks they belong to, by the same sum from
 * either direction: `trim` for the far one, which is what keeps a line from
 * being drawn across the hole in a ring, and `lead` for the near one, which is
 * what keeps a line out of the box a terminal is drawn in. The ring of canvas
 * every mark carries covers what is left between the line and the mark.
 */
function pathOf(parts: readonly GraphLine[], standing: ReadonlyMap<string, XYPosition>): string {
  let path = "";
  for (const part of parts) {
    const from = endOf(part.from, standing);
    const to = endOf(part.to, standing);
    if (!from || !to) continue;
    // The same sum with the ends swapped: `shortOf` pulls the second point back
    // towards the first, which from this direction is the start of the line.
    const start = shortOf(to, from, part.lead, part.curve);
    const end = shortOf(from, to, part.trim, part.curve);
    path += part.curve ? sigmoidPath(start, end) : straightPath(start, end);
    path += " ";
  }
  return path;
}

/**
 * Where one end of a line is: the middle of the mark it belongs to.
 *
 * A band's own lines are drawn inside the band's transform and their ends are
 * the commits in it, so a node's position — which React Flow keeps relative to
 * whatever it is placed in — is already the answer either way. A line into a
 * row names the band itself and the point inside it, which is the same sum.
 */
function endOf(end: LineEnd, standing: ReadonlyMap<string, XYPosition>): Point | null {
  const at = standing.get(end.node);
  return at ? { x: at.x + end.dx, y: at.y + end.dy } : null;
}

/** How a batch is drawn. The same shape for every path on the canvas. */
function stroke(style: StrokeStyle) {
  return {
    fill: "none",
    stroke: style.colour,
    strokeWidth: style.width,
    strokeOpacity: style.opacity,
    strokeDasharray: style.dash,
  };
}

/**
 * How wide a stretch of line answers to the cursor — in pixels of screen, not
 * in units of the graph.
 *
 * Measured on screen because the canvas is almost never looked at at 1:1: a
 * stretch fixed in the graph's own units is as wide as it was drawn only at
 * full size, a dozen pixels at the scale a repository fits the window at, and
 * under a pixel at the scale the canvas allows.
 */
const HOVER_SCREEN = 22;
/**
 * The most of the graph that stretch may cover, however far out the canvas is.
 *
 * Under a lane, so the stretch belongs to one row: two rows both answering at
 * once would leave the mark that appears looking arbitrary.
 */
const HOVER_LIMIT = LANE_HEIGHT * 0.6;
/** How near the pointer has to be to a dot to be on that commit. */
const DOT_REACH = 13;
/**
 * The circle a commit's halo is laid along: the dot, the ring of canvas it
 * carries, and then half the band itself — so the halo starts where a branch
 * head's does and is the same width; see `--halo`.
 */
const HALO_RADIUS = DOT_SIZE / 2 + 4;
/** How far the fold mark reaches out from the line it sits on. */
const MARK_RADIUS = 10;
/**
 * The arrows, drawn rather than set.
 *
 * An icon font's glyph is sized in `em` and laid out as HTML, which inside an
 * SVG `foreignObject` is at the mercy of the engine: WebKit gave it no size at
 * all, leaving the mark an empty disc. These are plain paths in the graph's own
 * coordinates, so every engine draws the same thing at every zoom.
 */
const FOLD =
  "M -8 -4 L -4.5 0 L -8 4 M -5 -4 L -1.5 0 L -5 4 M 8 -4 L 4.5 0 L 8 4 M 5 -4 L 1.5 0 L 5 4";

/** What the pointer is on, which is the only thing these are ever drawn for. */
type Under = {
  band: Band;
  fold: FoldTarget | null;
  dot: CommitDot | null;
  /** How far off the line the cursor was allowed to be when it was found. */
  reach: number;
};

/**
 * What the line and the commit under the cursor are offering.
 *
 * There is one of each of these on the canvas rather than one per line and one
 * per commit. Every commit used to carry the branch it might be cut into, and
 * every line the fold it might become, drawn and then hidden — between them
 * more than half of everything on the canvas, none of it ever looked at until
 * the cursor arrived.
 *
 * So the cursor is what draws them, and what it is over is worked out from
 * where it is: the graph is a grid, so the cell under the pointer is a division
 * and what is in that cell is a lookup. Nothing is measured, and nothing but
 * this is re-rendered.
 */
function Hover({
  bands,
  standing,
  onCommit,
}: {
  bands: readonly Band[];
  standing: ReadonlyMap<string, XYPosition>;
  onCommit: (node: CommitFlowNode, at: { x: number; y: number }) => void;
}) {
  const { t } = useTranslation();
  const flow = useReactFlow();
  const store = useStoreApi();
  const { fold } = useGraphActions();
  const [under, setUnder] = useState<Under | null>(null);
  // What is on screen now, so the listener can stay put across a rebuild.
  const showing = useRef(under);
  showing.current = under;
  const held = useRef(bands);
  held.current = bands;
  const placed = useRef(standing);
  placed.current = standing;
  const select = useRef(onCommit);
  select.current = onCommit;

  useEffect(() => {
    const host = store.getState().domNode;
    if (!host) return;

    const clear = () => {
      if (showing.current !== null) setUnder(null);
    };

    const find = (x: number, y: number): Under | null => {
      const at = flow.screenToFlowPosition({ x, y });
      const zoom = store.getState().transform[2];
      const reach = Math.min(HOVER_LIMIT, HOVER_SCREEN / zoom);

      for (const band of held.current) {
        const bandAt = placed.current.get(band.id) ?? band;
        const local = { x: at.x - bandAt.x, y: at.y - bandAt.y };
        // The band the cursor is actually in. Without this the cell worked out
        // against one band is looked up in another's index, and a repository
        // answers for a line that belongs to the one beside it. The margin is
        // what hangs off a band's own box: the offer of a branch, and the run
        // of sessions past the end of a row.
        if (
          local.x < -STEP.x ||
          local.y < -STEP.y ||
          local.x > band.width + STEP.x ||
          local.y > band.height + STEP.y
        ) {
          continue;
        }
        const cell = foldCell(local);

        const dot = band.lines.dots.get(cell);
        const dotAt = dot ? commitAt(dot, placed.current) : null;
        const onDot = dot && dotAt && Math.hypot(dotAt.x - local.x, dotAt.y - local.y) <= DOT_REACH;

        // Only the lines in the pointer's own cell are ever measured, which is
        // a handful of them however long the history is.
        let nearest: FoldTarget | null = null;
        let best = reach;
        for (const line of band.lines.folds.get(cell) ?? []) {
          const gap = distanceTo(line.run, local, best);
          if (gap <= best) {
            best = gap;
            nearest = line;
          }
        }

        if (!nearest && !onDot) continue;
        return { band, fold: nearest, dot: onDot ? dot : null, reach };
      }

      return null;
    };

    const move = (event: PointerEvent) => {
      // Mid-drag the canvas is moving under the cursor, and an offer that
      // appeared while it did would be an offer to fold whatever went past.
      if (event.buttons !== 0) {
        clear();
        return;
      }

      const next = find(event.clientX, event.clientY);
      if (next) {
        const now = showing.current;
        // The same answer as last time, which is what most moves of the mouse
        // come to: the cursor travels a long way inside one cell.
        if (now && now.band === next.band && now.fold === next.fold && now.dot === next.dot) return;
        setUnder(next);
        return;
      }

      clear();
    };

    /**
     * Commits no longer have DOM hit targets. Catch a press before React Flow
     * reads it as a pan, then turn a release on the same dot into the click the
     * old node supplied. A move remains neither a click nor a pan, just as a
     * press on the old `nopan` mark did.
     */
    const down = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (target instanceof Element && target.closest(".nopan")) return;
      const hit = find(event.clientX, event.clientY);
      if (!hit?.dot) return;

      event.preventDefault();
      event.stopPropagation();
      const dot = hit.dot;
      const origin = { x: event.clientX, y: event.clientY };
      let moved = false;

      const drag = (next: PointerEvent) => {
        if (next.pointerId !== event.pointerId) return;
        if (Math.hypot(next.clientX - origin.x, next.clientY - origin.y) > 4) moved = true;
      };
      const clean = () => {
        window.removeEventListener("pointermove", drag);
        window.removeEventListener("pointerup", up);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("blur", cancel);
      };
      const cancel = () => clean();
      const up = (ended: PointerEvent) => {
        if (ended.pointerId !== event.pointerId) return;
        clean();
        if (moved) return;
        const released = find(ended.clientX, ended.clientY);
        if (released?.dot !== dot) return;
        select.current(dot.node, { x: ended.clientX, y: ended.clientY });
      };

      window.addEventListener("pointermove", drag);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", cancel);
      window.addEventListener("blur", cancel);
    };

    // The native click still follows the pointer pair even though its press was
    // stopped above. Keep React Flow's pane click from immediately clearing the
    // commit selection and closing the menu that release just opened.
    const click = (event: MouseEvent) => {
      if (find(event.clientX, event.clientY)?.dot) event.stopPropagation();
    };

    host.addEventListener("pointermove", move);
    host.addEventListener("pointerleave", clear);
    host.addEventListener("pointerdown", down, true);
    host.addEventListener("click", click, true);
    return () => {
      host.removeEventListener("pointermove", move);
      host.removeEventListener("pointerleave", clear);
      host.removeEventListener("pointerdown", down, true);
      host.removeEventListener("click", click, true);
    };
  }, [flow, store]);

  if (!under) return null;
  const { band, dot } = under;
  const offer = under.fold;
  const bandAt = standing.get(band.id) ?? band;
  const dotAt = dot ? commitAt(dot, standing) : null;

  return (
    <g transform={`translate(${bandAt.x} ${bandAt.y})`}>
      {/* The branch that is not there yet, drawn where it would go: out of the
          dot and down to the row a branch cut here would take. Dotted because
          it is not there yet, and never takes the pointer — clicking the commit
          is what makes it real. */}
      {dotAt && <circle className="commit-hover" cx={dotAt.x} cy={dotAt.y} r={HALO_RADIUS} />}
      {dotAt && (
        <g className="ghost" transform={`translate(${dotAt.x} ${dotAt.y})`}>
          <path
            d={`M 7 0 C ${STEP.x * 0.55} 0, ${STEP.x * 0.55} ${STEP.y}, ${STEP.x - 8} ${STEP.y}`}
          />
          <circle cx={STEP.x} cy={STEP.y} r="8" />
        </g>
      )}

      {offer && (
        // biome-ignore lint/a11y/useSemanticElements: a button here is HTML in a foreignObject, which is what left the mark empty in WebKit
        <g
          className="edge__fold"
          role="button"
          aria-label={t("graph.fold")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            fold(band.id, offer.keep);
          }}
        >
          {/* The line again, drawn in nothing and thick enough to be aimed at:
              the whole stretch is the button, the way it reads. */}
          <path
            className="edge__hit"
            d={runPath(offer.run)}
            style={{ strokeWidth: under.reach * 2 }}
          />
          {/* On the line's own middle, where a mark is furthest from the marks
              at either end of it. */}
          <g className="edge__mark" transform={`translate(${offer.at.x} ${offer.at.y})`}>
            {/* Canvas, so the line does not run through the arrows. */}
            <circle className="edge__mark__disc" r={MARK_RADIUS} />
            <path className="edge__mark__arrows" d={FOLD} />
          </g>
        </g>
      )}
    </g>
  );
}

/** The line the pointer is on, as something that can be drawn. */
function runPath(run: readonly number[]): string {
  let path = `M ${run[0]},${run[1]}`;
  for (let index = 2; index + 1 < run.length; index += 2) {
    path += ` L ${run[index]},${run[index + 1]}`;
  }
  return path;
}
