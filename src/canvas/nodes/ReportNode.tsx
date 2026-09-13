import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";

import type { ReportFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

export function ReportNode({ data }: NodeProps<ReportFlowNode>) {
  const { t } = useTranslation();
  const { session, card } = data;
  const { showSession } = useGraphActions();

  return (
    <div className="report">
      <button
        type="button"
        className="report__head nopan"
        aria-label={t("report.open")}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          showSession(session);
        }}
      >
        <span className="report__who">{session.branch}</span>
        <span className="report__count">{card.count ?? t("report.working")}</span>
      </button>

      {card.doing.length > 0 && <p className="report__doing">{card.doing.join("\n")}</p>}

      {card.steps.length > 0 && (
        <div className="report__steps">
          {card.steps.map((step) => (
            <div
              // Keyed by position: the titles are the agent's own and can repeat.
              key={step.at}
              className={`report__step${step.done ? " is-done" : ""}${step.here ? " is-here" : ""}`}
            >
              <span className="report__mark" aria-hidden="true">
                {step.done ? "✓" : step.here ? "●" : "·"}
              </span>
              <span className="report__title">{step.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
