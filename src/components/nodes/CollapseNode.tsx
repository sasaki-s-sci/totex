import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { useHistoryPull } from "../../hooks/useHistoryPull";
import type { CollapseFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

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
 * away, and how far it is moved is how much — see `useHistoryPull`. The number
 * in it is the same number throughout, what is still folded away, and the pill
 * itself never moves: it is the point the band grows away from, so a repository
 * being pulled open runs out to the right of it while this stays put.
 *
 * A count says how much and nothing about what, and what answers that is the
 * repository itself. Every frame of a pull lays it out again at the depth the
 * hand has reached and draws the whole band dashed — see `useHistoryDepth` —
 * so what is being chosen is read off the history rather than off a number.
 */
export function CollapseNode({ data }: NodeProps<CollapseFlowNode>) {
  const { t } = useTranslation();
  const { repository, hidden } = data;
  const { expand, reachFold, keepFold } = useGraphActions();
  // What is drawn now, which is what a pull is counted from. Taken from the
  // count behind the fold rather than from the depth that was asked for: a
  // repository nobody has asked anything of is showing the default, and this is
  // the only place that knows what the default came out as.
  const shown = repository.commits.length - hidden;

  const { pill, onPointerDown, onClick } = useHistoryPull({
    hidden,
    shown,
    onOpen: () => expand(repository.id),
    onReach: (depth) => reachFold(repository.id, depth),
    onKeep: () => keepFold(repository.id),
  });

  return (
    <div className="cell collapse">
      <button
        ref={pill}
        type="button"
        className="mark mark--centred nopan collapse__more"
        aria-label={t("graph.expand")}
        onPointerDown={onPointerDown}
        onClick={onClick}
      >
        {/* The ink every mark on the canvas is drawn in, so the arrows read as
            the end of the history rather than as part of the pill's chrome. */}
        <KeyboardDoubleArrowLeftIcon className="collapse__arrows" sx={{ fontSize: 11 }} />
        {hidden}
      </button>
    </div>
  );
}
