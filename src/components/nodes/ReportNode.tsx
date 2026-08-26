import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";

import type { ReportFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

/**
 * What a terminal says it is working on.
 *
 * The quiet twin of the question card. A question is a turn nobody has taken
 * and the card is there to be pressed; this is nothing of the sort — the agent
 * is working, nobody is waiting, and the card is there to be read and left
 * alone. So it is the same card in the same place with the same head, and
 * everything inside it is text: there is one button on it, and it is the way
 * into the terminal, which is where anything that could be done is done.
 *
 * It only exists because somebody set it up. Nothing in a terminal reports by
 * itself — the app stands a server up beside the sessions and the agent has to
 * have been registered against it — so this card is the visible half of a
 * choice that was made on the settings page, and its absence is not a
 * failure. See `mcp` for what stands behind it.
 *
 * The words in it are already cut to width by the layout. Nothing is measured
 * here: the canvas needs the height of this card before it can place it.
 */
export function ReportNode({ data }: NodeProps<ReportFlowNode>) {
  const { t } = useTranslation();
  const { session, card } = data;
  const { showSession } = useGraphActions();

  return (
    <div className="report">
      {/* Whose work it is, and the way through to it. The whole row is the way
          in, the same as a question's: a card is small, and a target the size
          of one word is a target somebody has to aim at. */}
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
        {/* How far through it is, where there is a plan to be far through. The
            corner of the card is the one place a number can stand without
            being read as part of the sentence under it. */}
        <span className="report__count">{card.count ?? t("report.working")}</span>
      </button>

      {/* What is being done, in the window's own face rather than the
          terminal's: this is a sentence somebody wrote to be read, and not a
          command that has to be read character by character. */}
      {card.doing.length > 0 && <p className="report__doing">{card.doing.join("\n")}</p>}

      {/* The plan it is a step of. Marked rather than numbered: the numbers
          would be the agent's own list, and what matters from across a canvas
          is which of them is finished and which one is in hand. */}
      {card.steps.length > 0 && (
        <div className="report__steps">
          {card.steps.map((step) => (
            <div
              // By where it stands in the plan rather than by what it says: the
              // titles are the agent's own, and two of them can say the same
              // thing.
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
