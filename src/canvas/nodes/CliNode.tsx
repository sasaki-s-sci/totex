import CloseIcon from "@mui/icons-material/Close";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { CliFlowNode } from "../../lib/graph";
import { CliGlyph } from "../../marks";
import { useCliDoing } from "../cliDoing";
import { useCliHolding, useCliJump } from "../cliJumps";
import { useCliPlace } from "../cliPlaces";
import { useTypedLine } from "../cliTyped";
import { useGraphActions } from "../graphActions";
import { CliIdentity } from "./CliIdentity";

export function CliNode({ id, data }: NodeProps<CliFlowNode>) {
  const { t } = useTranslation();
  const { session, showing, ordinal, group } = data;
  const { showSession, endSession } = useGraphActions();
  const jump = useCliJump(id);
  const holding = useCliHolding();
  const said = useTypedLine(session.id);
  const doing = useCliDoing(session.id);
  const place = useCliPlace(group);

  const name = ordinal ? `${t("cli.shell")} ${ordinal}` : t("cli.shell");

  return (
    <div className="cell cli">
      <div className="mark mark--centred cli__row">
        {/* Room is always held for the place and the end mark, so a stack never shifts under the pointer. */}
        {showing && holding && place ? (
          <span className="cli__place" aria-hidden="true">
            <span className="cli__place-name">{place}</span>
            <CliIdentity cwd={session.cwd} shown />
          </span>
        ) : null}

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
          <CliGlyph doing={doing} jump={jump} />
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

        {said === null ? null : (
          <span className="cli__said" aria-hidden="true">
            {said}
          </span>
        )}
      </div>
    </div>
  );
}
