import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import type { NodeProps } from "@xyflow/react";
import { type RefObject, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Pull, useHistoryPull } from "../../hooks/useHistoryPull";
import { type CollapseFlowNode, circlesOf, DOT_SIZE, type Point } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

/** How many of the folded commits the peek draws. */
const PEEK = 12;
/**
 * How far apart it stands them, which is not how far apart they would land.
 *
 * A commit takes a full column of the grid, and the fold sits a column or two
 * in from the left edge of the canvas: at that spacing the peek is one ghost
 * and the rest is clipped, which says nothing at all. So the run is drawn
 * closed up — a trail receding into the fold rather than a measurement of it.
 * What it is saying is that there is history back there and roughly how much of
 * it a pull has reached, and neither of those is a distance.
 */
const PEEK_STEP = 34;
/** The peek's own box: the run of dots, and a step past the last of them. */
const RUN_WIDTH = (PEEK + 1) * PEEK_STEP;
/** Enough for a dot and the ring of canvas colour it carries. */
const RUN_HEIGHT = 24;

/**
 * Where the history that is not being shown would be, and the way to ask for it.
 *
 * Out by default rather than on hover, for the same reason the branch buttons
 * are: a graph opens folded, so this is the first thing most of them are opened
 * for. There is one per repository — not one per commit, the way folding the
 * other way is — so it costs the canvas a single mark rather than a row of them.
 *
 * It stands in the cell the folded history would run through, with the dash out
 * to the oldest commit still shown coming off it, so the row reads as history
 * carrying on past the left edge of what is drawn.
 *
 * Clicking it brings all of that back. Holding it turns it into a handle: out
 * to the left is history coming back, in to the right is history being folded
 * away, and how far it is moved is how much — see `useHistoryPull`. The count
 * is the same number throughout: what is still folded away, which the hand runs
 * up or down to whatever is wanted.
 *
 * A count says how much and nothing about what, so the pill also shows what is
 * behind it: see `Peek`, which is drawn while the cursor is on the pill and for
 * as long as a pull lasts.
 */
export function CollapseNode({ data }: NodeProps<CollapseFlowNode>) {
  const { t } = useTranslation();
  const { repository, hidden } = data;
  const { expand, fold } = useGraphActions();
  // What is drawn now, which is what a pull is added to. Taken from the count
  // behind the fold rather than from the depth that was asked for: a repository
  // nobody has asked anything of is showing the default, and this is the only
  // place that knows what the default came out as.
  const shown = repository.commits.length - hidden;

  // Whether what is behind the fold is being shown, and the two things that ask
  // for it. Hover is the ask; a pull is what keeps it up once the hand has
  // carried the pointer off the pill it started on.
  const [hovering, setHovering] = useState(false);
  const [pulling, setPulling] = useState(false);
  const peeking = hovering || pulling;

  // What the peek is drawn from, held rather than stated: a pull reports a new
  // one every frame, and a graph re-rendered at that rate is the thing the pull
  // was written to avoid. `Peek` reads it and writes the elements itself.
  const at = useRef<Pull | null>(null);
  const paint = useRef<(() => void) | null>(null);
  const under = useRef(false);

  const onPreview = useCallback((pull: Pull | null) => {
    at.current = pull;
    // Only the two ends of a pull are worth a render — the peek has to be up
    // before the first frame is drawn and can go once the last one has been.
    if (under.current !== (pull !== null)) {
      under.current = pull !== null;
      setPulling(pull !== null);
    }
    paint.current?.();
  }, []);

  const { pill, count, onPointerDown, onClick } = useHistoryPull({
    hidden,
    shown,
    onOpen: () => expand(repository.id),
    onPull: (reveal) =>
      // Pulling out the whole of it asks the same thing a click does, and has
      // to be asked the same way: a depth pinned at today's count would fold
      // the history away again a commit at a time as more of it arrived. A pull
      // the other way is a depth like any other, and `reveal` is negative there.
      reveal >= hidden ? expand(repository.id) : fold(repository.id, shown + reveal),
    onPreview,
  });

  return (
    <div className="cell collapse">
      {peeking && (
        <Peek
          repository={repository}
          shown={shown}
          hidden={hidden}
          pill={pill}
          at={at}
          paint={paint}
        />
      )}
      <button
        ref={pill}
        type="button"
        className="mark mark--centred nopan collapse__more"
        aria-label={t("graph.expand")}
        onPointerDown={onPointerDown}
        onClick={onClick}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
        onFocus={() => setHovering(true)}
        onBlur={() => setHovering(false)}
      >
        {/* The ink every mark on the canvas is drawn in, so the arrows read as
            the end of the history rather than as part of the pill's chrome. */}
        <KeyboardDoubleArrowLeftIcon className="collapse__arrows" sx={{ fontSize: 11 }} />
        {/* In a span of its own because a pull writes over it every frame, and
            what is written has to go somewhere React will not have to diff. */}
        <span ref={count} className="collapse__count">
          {hidden}
        </span>
      </button>
    </div>
  );
}

/**
 * What is behind the fold, drawn where it would be.
 *
 * The pill says how many commits are folded away and cannot say which, so this
 * is the rest of the answer: the folded history laid out to the left of the
 * pill on the grid it would come back onto, faint because it is not there, and
 * the one commit at the end of the run named in full.
 *
 * A pull is what makes it worth having. The pill's count runs down as the hand
 * moves and the commits it has reached fill in behind it — dashed rings turning
 * into the graph's own marks, the fold's dash into the history's own line — so
 * a pull is chosen by what is coming back rather than by a number counting off.
 * The named commit is the far end of what has been reached, which is the thing
 * a pull is actually deciding: how far back to go.
 *
 * A pull the other way needs none of the run: what it is folding away is drawn
 * on the canvas already, and the pill grows over it as it goes. So the run
 * stays where it is and only the name changes, down the history the hand is
 * closing onto.
 *
 * Drawn only while the cursor is on the pill or a pull is under way, the way
 * everything else on this canvas that is an offer rather than a fact is — see
 * `GraphLines`, which draws the fold marks the same way and for the same reason.
 *
 * Hung off the pill's own far end rather than off the cell: the pill grows out
 * to the left as it is pulled, and a peek anchored to the cell would be
 * swallowed by the pill it is coming out of.
 */
function Peek({
  repository,
  shown,
  hidden,
  pill,
  at,
  paint,
}: {
  repository: CollapseFlowNode["data"]["repository"];
  shown: number;
  hidden: number;
  pill: RefObject<HTMLButtonElement | null>;
  at: RefObject<Pull | null>;
  paint: RefObject<(() => void) | null>;
}) {
  const peek = useRef<HTMLDivElement>(null);
  const back = useRef<SVGLineElement>(null);
  const backDots = useRef<SVGPathElement>(null);
  const id = useRef<HTMLSpanElement>(null);
  const subject = useRef<HTMLSpanElement>(null);

  /** Where the folded commits would stand, oldest of them furthest out. */
  const drawn = Math.min(hidden, PEEK);
  const dots = useMemo(
    () => Array.from({ length: drawn }, (_, step): Point => ({ x: -(step + 1) * PEEK_STEP, y: 0 })),
    [drawn],
  );
  // Past the last dot when there is more history than the peek draws, and on it
  // when there is not: the line stops where the history does.
  const span = hidden > PEEK ? RUN_WIDTH : drawn * PEEK_STEP;

  const draw = useCallback(() => {
    const element = peek.current;
    if (!element) return;
    const pull = at.current;
    // At rest the pill's far end is half of it, which only this side can
    // measure: how wide the pill is depends on how many digits the count runs
    // to, and on how much room the stylesheet gives it to stand a pull up in.
    const far = pull ? pull.far : (pill.current?.offsetWidth ?? 0) / 2;
    element.style.setProperty("--far", `${far}px`);

    // Only what is coming out of the fold fills the run in. A pull the other
    // way is folding history away, and the history it is folding is on the
    // canvas already — the pill covers it as it grows.
    const filled = Math.max(0, Math.min(pull?.reveal ?? 0, drawn));
    back.current?.setAttribute("x2", String(-filled * PEEK_STEP));
    backDots.current?.setAttribute("d", circlesOf(dots.slice(0, filled), DOT_SIZE / 2));

    // The oldest commit that would still be drawn, which is the whole of what
    // the hand is choosing whichever way it went. Before a pull has started
    // there is nothing being chosen, so it names the first commit behind the
    // fold instead: what a pull would reach the moment it began to move.
    const reached = pull ? shown + pull.reveal - 1 : shown;
    const commit = repository.commits[clamp(reached, 0, repository.commits.length - 1)];
    if (id.current) id.current.textContent = commit?.shortId ?? "";
    if (subject.current) subject.current.textContent = commit?.subject ?? "";
  }, [at, dots, drawn, pill, repository, shown]);

  // Lent to the node above, which is where a pull's frames arrive, and drawn
  // once here as well: the first frame of a pull is written before React has
  // put any of this in the window.
  useLayoutEffect(() => {
    paint.current = draw;
    draw();
    return () => {
      paint.current = null;
    };
  }, [draw, paint]);

  return (
    <div className="collapse__peek" ref={peek} aria-hidden="true">
      <div className="peek__commit">
        <span className="peek__id" ref={id} />
        <span className="peek__subject" ref={subject} />
      </div>
      <svg
        className="peek__run"
        aria-hidden="true"
        width={RUN_WIDTH}
        height={RUN_HEIGHT}
        viewBox={`${-RUN_WIDTH} ${-RUN_HEIGHT / 2} ${RUN_WIDTH} ${RUN_HEIGHT}`}
      >
        {/* The fold's own dash, carried on past the bar: this is the same line
            the collapse edge draws to the oldest commit still shown. */}
        <path className="peek__line" d={`M 0 0 H ${-span}`} />
        {/* And what a pull has reached, drawn over it in the history's own
            line. Both are written by `draw`, every frame of a pull. */}
        <line className="peek__back" ref={back} x1={0} y1={0} x2={0} y2={0} />
        <path className="peek__dots" d={circlesOf(dots, DOT_SIZE / 2)} />
        <path className="peek__back-dots" ref={backDots} d="" />
      </svg>
    </div>
  );
}

/** Kept inside the history, however far a pull that outlived it had reached. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
