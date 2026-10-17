import CloseIcon from "@mui/icons-material/Close";
import type { NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "../../lib/appSettings";
import type { CliFlowNode } from "../../lib/graph";
import { CliGlyph } from "../../marks";
import { MonitorBadge } from "../../monitor/MonitorBadge";
import { useCliDoing } from "../cliDoing";
import { useCliJump } from "../cliJumps";
import { useTypedLine } from "../cliTyped";
import { useGraphActions } from "../graphActions";
import { useMarkSizes } from "../markSizes";

export function CliNode({ id, data }: NodeProps<CliFlowNode>) {
  const { t } = useTranslation();
  const marks = useMarkSizes();
  const { session, showing, ordinal } = data;
  const { showSession, endSession } = useGraphActions();
  const jump = useCliJump(id);
  const said = useTypedLine(session.id);
  const doing = useCliDoing(session.id);
  const { monitor } = useAppSettings();

  const name = ordinal ? `${t("cli.shell")} ${ordinal}` : t("cli.shell");

  return (
    <div className="cell cli">
      <div className="mark mark--centred cli__row">
        <button
          type="button"
          className={`cli__open nopan${showing ? " is-showing" : ""}`}
          aria-label={name}
          aria-pressed={showing}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            showSession(session);
          }}
        >
          <CliGlyph doing={doing} jump={jump} size={marks.cli} />
        </button>

        <button
          type="button"
          className="cli__end nopan"
          aria-label={t("cli.end")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            endSession(session);
          }}
        >
          <CloseIcon sx={{ fontSize: 9 }} />
        </button>

        <MonitorBadge id={session.id} canvas />
        {/* Monitor's badge takes this place and already carries the typed line. */}
        {said === null || monitor.enabled ? null : (
          <span
            className="cli__said"
            aria-hidden="true"
            style={{ "--said-rows": said.split("\n").length } as CSSProperties}
          >
            {said}
          </span>
        )}
      </div>
    </div>
  );
}
