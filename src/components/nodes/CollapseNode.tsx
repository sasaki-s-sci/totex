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
 * Clicking it brings all of that back. Holding it turns it into a handle to be
 * pulled out to the left, and how far it is pulled is how much comes back — see
 * `useHistoryPull`. The count is the same number either way: what is still
 * folded away, which a pull runs down to whatever is wanted.
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

  const { pill, count, onPointerDown, onClick } = useHistoryPull({
    hidden,
    onOpen: () => expand(repository.id),
    onPull: (reveal) =>
      // Pulling out the whole of it asks the same thing a click does, and has
      // to be asked the same way: a depth pinned at today's count would fold
      // the history away again a commit at a time as more of it arrived.
      reveal >= hidden ? expand(repository.id) : fold(repository.id, shown + reveal),
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
        {/* In a span of its own because a pull writes over it every frame, and
            what is written has to go somewhere React will not have to diff. */}
        <span ref={count} className="collapse__count">
          {hidden}
        </span>
      </button>
    </div>
  );
}
