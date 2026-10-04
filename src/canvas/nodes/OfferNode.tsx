import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { OfferFlowNode } from "../../lib/graph";
import { CHIP_STEP, HEAD_SIZE, SESSION_WIDTH } from "../../lib/graph/model";
import { CliMark } from "../../marks";
import { useGraphActions } from "../graphActions";
import { useMarkSizes } from "../markSizes";

/**
 * A terminal that is not there yet, drawn only while Ctrl+Shift is held; taking it starts it. A new
 * workspace also draws the ring it would be, in the ring column beside it: the terminal follows it.
 */
export function OfferNode({ data }: NodeProps<OfferFlowNode>) {
  const { t } = useTranslation();
  const marks = useMarkSizes();
  const { openWork, newWork } = useGraphActions();
  const name = data.kind === "new" ? t("offer.new") : data.branch;

  return (
    <div className="cell offer">
      {data.kind === "new" && (
        <span
          className="mark mark--centred offer__ring"
          style={{ left: SESSION_WIDTH / 2 - CHIP_STEP, width: HEAD_SIZE, height: HEAD_SIZE }}
          aria-hidden="true"
        />
      )}

      <div className="mark mark--centred cli__row">
        <span className="offer__name" aria-hidden="true">
          {name}
        </span>

        <button
          type="button"
          className="offer__take nopan"
          aria-label={
            data.kind === "new"
              ? t("offer.newIn", { name: data.repository.name })
              : t("offer.open", { name })
          }
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            if (data.kind === "new") newWork(data.repository);
            else openWork({ repository: data.repository, branch: data.branch, cwd: data.cwd });
          }}
        >
          <CliMark size={marks.cli} />
        </button>
      </div>
    </div>
  );
}
