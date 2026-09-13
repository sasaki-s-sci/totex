import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import type { NodeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AskFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

function AskWriting({
  written,
  onWrite,
  onSend,
  label,
  className,
  focus,
}: {
  written: string;
  onWrite: (text: string) => void;
  onSend: () => void;
  label: string;
  className: string;
  focus: boolean;
}) {
  const { t } = useTranslation();
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focus) field.current?.focus({ preventScroll: true });
  }, [focus]);

  return (
    <form
      className={className}
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <input
        ref={field}
        className="ask__written nodrag nopan"
        value={written}
        aria-label={t("ask.write")}
        placeholder={label}
        onChange={(event) => onWrite(event.target.value)}
      />
      <button type="submit" className="ask__send nodrag nopan" aria-label={t("ask.send")}>
        <KeyboardReturnIcon sx={{ fontSize: 13 }} />
      </button>
    </form>
  );
}

export function AskNode({ data }: NodeProps<AskFlowNode>) {
  const { t } = useTranslation();
  const { session, ask, card } = data;
  const { answer, reply, point, pick, take, showSession } = useGraphActions();

  const [written, setWritten] = useState("");
  const asked = useRef(ask.seq);
  // Emptied when the question changes, not when the card goes: the card is one node for the session's whole life.
  if (asked.current !== ask.seq) {
    asked.current = ask.seq;
    setWritten("");
  }

  return (
    <div className="ask">
      <button
        type="button"
        className="ask__head nopan"
        aria-label={t("ask.open")}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          showSession(session);
        }}
      >
        <span className="ask__who">{session.branch}</span>
        <span className="ask__ordinal">{t("ask.asking")}</span>
      </button>

      {card.detail.length > 0 && <div className="ask__detail">{card.detail.join("\n")}</div>}

      {card.question.length > 0 && <p className="ask__question">{card.question.join("\n")}</p>}

      {ask.taking === "words" ? (
        <AskWriting
          className="ask__field nopan"
          written={written}
          onWrite={setWritten}
          onSend={() => reply(session, ask, written)}
          label={t("ask.write")}
          focus={false}
        />
      ) : (
        <>
          <div className="ask__choices">
            {card.choices.map((choice) => (
              <div
                key={choice.key}
                className={`ask__choice${choice.selected ? " is-here" : ""}${
                  choice.picked ? " is-held" : ""
                }`}
              >
                <button
                  type="button"
                  className="ask__hold nopan"
                  aria-label={ask.picking ? t("ask.pick") : t("ask.point")}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    // On a list several answers are picked from, a press only walks the mark there; the return under the list ends it.
                    if (ask.picking) pick(session, ask, choice.key);
                    else point(session, ask, choice.key);
                  }}
                >
                  {ask.picking ? (
                    <span className="ask__box" aria-hidden="true">
                      {choice.picked ? "◉" : "◯"}
                    </span>
                  ) : ask.taking === "walk" ? (
                    <span className="ask__mark" aria-hidden="true">
                      {choice.selected ? "❯" : ""}
                    </span>
                  ) : (
                    <span className="ask__key">{choice.key}</span>
                  )}
                </button>
                {ask.writing && choice.selected ? (
                  <AskWriting
                    className="ask__writing"
                    written={written}
                    onWrite={setWritten}
                    onSend={() => reply(session, ask, written)}
                    label={choice.lines.join(" ")}
                    focus={true}
                  />
                ) : (
                  <button
                    type="button"
                    className="ask__answer nopan"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (ask.picking) point(session, ask, choice.key);
                      else answer(session, ask, choice.key);
                    }}
                  >
                    {choice.lines.join("\n")}
                  </button>
                )}
              </div>
            ))}
          </div>

          {ask.picking && (
            <div className="ask__work nopan" onPointerDown={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="ask__take nodrag nopan"
                aria-label={t("ask.take")}
                onClick={(event) => {
                  event.stopPropagation();
                  take(session, ask);
                }}
              >
                <KeyboardReturnIcon sx={{ fontSize: 13 }} />
                <span className="ask__taking">{t("ask.take")}</span>
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
