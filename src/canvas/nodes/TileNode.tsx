import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { TILE, type TileFlowNode } from "../../lib/graph";
import { MonitorBadge } from "../../monitor/MonitorBadge";
import { isAgent } from "../../monitor/model";
import { useMonitorGlance } from "../../monitor/runtime";
import { useGraphActions } from "../graphActions";

/**
 * A plain terminal's tile: what it is running, at its fixed length or grown from it. A coding CLI
 * has no tile: its card is beside its node, and this space stays empty until its report arrives.
 */
export function TileNode({ data }: NodeProps<TileFlowNode>) {
  const { t } = useTranslation();
  const { session, units } = data;
  const { resizeTile } = useGraphActions();
  const agent = isAgent(useMonitorGlance(session.id));
  if (agent) return null;

  return (
    <div className="tile">
      <div className="tile__body">
        <MonitorBadge id={session.id} canvas />
      </div>

      <div className="tile__bar nopan" onPointerDown={(event) => event.stopPropagation()}>
        <button
          type="button"
          className="tile__press"
          aria-label={t("tile.shorter")}
          disabled={units <= TILE.start}
          onClick={(event) => {
            event.stopPropagation();
            resizeTile(session.id, units - 1);
          }}
        >
          <RemoveIcon sx={{ fontSize: 12 }} />
        </button>
        <button
          type="button"
          className="tile__press"
          aria-label={t("tile.taller")}
          disabled={units >= TILE.most}
          onClick={(event) => {
            event.stopPropagation();
            resizeTile(session.id, units + 1);
          }}
        >
          <AddIcon sx={{ fontSize: 12 }} />
        </button>
      </div>
    </div>
  );
}
