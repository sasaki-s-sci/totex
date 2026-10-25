import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { CliFlowNode } from "../../lib/graph";
import { useCliReorder } from "../cliReorder";
import { useGraphActions } from "../graphActions";

// The reorder target stays on the edge; the card owns its content and close control.
export function CliNode({ id, data }: NodeProps<CliFlowNode>) {
  const { t } = useTranslation();
  const { session, showing, ordinal } = data;
  const { showSession } = useGraphActions();
  const reorder = useCliReorder(id, session, data.group);

  const name = ordinal ? `${t("cli.shell")} ${ordinal}` : t("cli.shell");

  return (
    <div className="cell cli">
      <div className="mark mark--centred cli__row">
        <button
          type="button"
          className={`cli__open nopan${showing ? " is-showing" : ""}`}
          aria-label={name}
          aria-pressed={showing}
          {...reorder.pointer}
          onClick={(event) => {
            event.stopPropagation();
            if (reorder.takeMoved()) return;
            showSession(session);
          }}
        />
      </div>
    </div>
  );
}
