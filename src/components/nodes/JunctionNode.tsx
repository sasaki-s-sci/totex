import type { NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { JUNCTION_SIZE, type JunctionFlowNode } from "../../lib/graph";

/**
 * Where the branches that start the same way are gathered.
 *
 * A knot in the wiring and nothing else: `dev/` is not a ref, so there is
 * nothing to press and nothing to open. The mark says so by standing under the
 * size of a commit, which is the least thing on here that is real, and by being
 * struck rather than filled — an asterisk, which is what stands in for the rest
 * of a name. Read with the word set over it, the knot is `dev/*`.
 *
 * The path it gathers is set on the line above it, the way every name on this
 * canvas is set over the thing it names. It used to carry none, on the reading
 * that the shared start is already written along every line fanning out of the
 * knot: it is, but only once the eye has followed one of them out to its name
 * and back, and a fan of a dozen is exactly where that costs the most. The word
 * is the cheap half of the answer.
 *
 * The count stays with the pointer, which is where a number belongs: it is what
 * the group amounts to rather than what it is.
 */
export function JunctionNode({ data }: NodeProps<JunctionFlowNode>) {
  const { t } = useTranslation();
  const { prefix, members } = data;

  return (
    // The knot's size is handed to the stylesheet rather than written there,
    // so the drawing, the air under the word and `JUNCTION_TRIM` — where the
    // lines into the knot are cut — are all the one measure.
    <div className="cell junction" style={{ "--knot": `${JUNCTION_SIZE}px` } as CSSProperties}>
      {/* With the trailing slash the prefix is held without, because the slash
          is the half of it that says this is a namespace and not a branch. */}
      <span className="junction__name">{`${prefix}/`}</span>
      {/* No `nopan`: there is nothing to press here, so a hand that comes down on
          the knot is a hand on the canvas and should carry it. */}
      <span
        className="mark mark--centred junction__knot"
        title={t("graph.junction", { prefix, count: members })}
      >
        <svg
          className="junction__arms"
          viewBox={`0 0 ${JUNCTION_SIZE} ${JUNCTION_SIZE}`}
          aria-hidden="true"
        >
          {ARMS.map(({ degrees, ...ends }) => (
            <line key={degrees} {...ends} />
          ))}
        </svg>
      </span>
    </div>
  );
}

/**
 * The three arms of the asterisk: one upright, and one leaning sixty degrees
 * off it either way. Each is a line from one edge of the knot's disc to the
 * other through its centre, in the square the knot is drawn in.
 *
 * Drawn as lines rather than as bars of paint, because they were bars once and
 * did not cross. A one-pixel gradient tile centred in a ten-pixel box begins
 * four and a half pixels in, and the engine sets a tile down on a whole pixel
 * before it turns the box — so each arm was a half-pixel off its own centre,
 * and each in a different direction once turned. Three arms off centre by half
 * a pixel apiece is an asterisk with three near-misses for a middle. A line has
 * no tile to snap: it is geometry, and three of them through one point cross
 * at that point at every size the canvas is zoomed to.
 */
const ARMS = [90, 30, 150].map((degrees) => {
  const half = JUNCTION_SIZE / 2;
  const angle = (degrees * Math.PI) / 180;
  // Rounded so the upright arm is written at the centre and not a hair off it
  // in the sixteenth decimal, which is what the cosine of a right angle comes
  // out as.
  const dx = Math.round(half * Math.cos(angle) * 1000) / 1000;
  const dy = Math.round(half * Math.sin(angle) * 1000) / 1000;
  return { degrees, x1: half - dx, y1: half - dy, x2: half + dx, y2: half + dy };
});
