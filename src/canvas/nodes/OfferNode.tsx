import AddIcon from "@mui/icons-material/Add";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { OfferFlowNode } from "../../lib/graph";
import { CLI_GLYPH, CliMark } from "../../marks";
import { useGraphActions } from "../graphActions";

/** A terminal that is not there yet, drawn only while Ctrl+Shift is held; taking it starts it. */
export function OfferNode({ data }: NodeProps<OfferFlowNode>) {
  const { t } = useTranslation();
  const { openWork, newWork } = useGraphActions();
  const name = data.kind === "new" ? t("offer.new") : data.branch;

  return (
    <div className="cell offer">
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
          {data.kind === "new" ? (
            <AddIcon sx={{ fontSize: CLI_GLYPH }} />
          ) : (
            <CliMark size={CLI_GLYPH} />
          )}
        </button>
      </div>
    </div>
  );
}
