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
      />
    </div>
  );
}
