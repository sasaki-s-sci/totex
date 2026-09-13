import KeyboardDoubleArrowLeftIcon from "@mui/icons-material/KeyboardDoubleArrowLeft";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { CollapseFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";
import { useHistoryPull } from "../hooks/useHistoryPull";

export function CollapseNode({ data }: NodeProps<CollapseFlowNode>) {
  const { t } = useTranslation();
  const { repository, hidden } = data;
  const { expand, reachFold, keepFold } = useGraphActions();
  // Counted from what is drawn, not the depth asked for: an untouched repository shows the default, known only here.
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
        <KeyboardDoubleArrowLeftIcon className="collapse__arrows" sx={{ fontSize: 11 }} />
        {hidden}
      </button>
    </div>
  );
}
