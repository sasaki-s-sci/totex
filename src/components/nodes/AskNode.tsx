import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import type { NodeProps } from "@xyflow/react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AskFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

/**
 * A question something running in a terminal has stopped to ask, and the
 * answers to it.
 *
 * The one card this canvas grows by itself, and the one thing on it that is
 * words rather than a mark. Everything else here says what it is by being a
 * shape in a place; a question cannot, because what is being asked is the whole
 * of it. So it is drawn the same way every time — what it is about, then the
 * question, then the answers in a row down the foot of it — and the sameness is
 * the point: from across a canvas, this shape means somebody is waiting, and it
 * is the same shape whether the agent wants to run a command or wants to know
 * which of three things you meant.
 *
 * It is answered from here, which is the whole reason it is here. A question is
 * a turn: nothing else happens in that session until it is taken, and walking
 * to the terminal, finding the prompt and typing the number is a walk that
 * decides nothing. Pressing the answer types it at the agent — the key the
 * agent itself printed, so what is taken is exactly what the terminal would
 * have taken — and the card goes at once.
 *
 * What the foot of the card holds is the one thing that changes with the
 * question, because it is the one thing the agent did not draw the same way
 * every time: a list with keys beside it is drawn with them, a list that is
 * walked with the arrow keys is drawn with the agent's own mark and no keys at
 * all, and a question with no list under it is drawn as the one place to write.
 * Everything about how any of that is typed at the session is the session's, so
 * that a card never invents a keystroke — see `ask/watch.rs`.
 *
 * The words in it are already cut to width by the layout. Nothing is measured
 * here: the canvas needs the height of this card before it can place it, and a
 * card that decided its own size would be one the graph had to be rebuilt for
 * after it had been drawn.
 */
export function AskNode({ data }: NodeProps<AskFlowNode>) {
  const { t } = useTranslation();
  const { session, ask, card } = data;
  const { answer, reply, showSession } = useGraphActions();

  /** What has been written at a question that wants words, until it is sent. */
  const [written, setWritten] = useState("");
  // Emptied when the question changes, rather than when the card goes. A card
  // is one node for as long as its session has one to draw, so the answer half
  // written to "what shall I call it" would otherwise still be sitting there
  // when the agent asks what to do instead.
  const asked = useRef(ask.seq);
  if (asked.current !== ask.seq) {
    asked.current = ask.seq;
    setWritten("");
  }

  return (
    <div className="ask">
      {/* Which terminal is asking, and the way through to it. Everything a card cannot hold is in there — the diff, the
          rest of the argument, the reason — and one press is the whole of the
          way to it. */}
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

      {/* What it is about, as the agent wrote it: a command, a path, a tool.
          Set in the terminal's own face, because that is where it came from and
          a command in a proportional face is a command somebody has to read
          twice. */}
      {card.detail.length > 0 && <div className="ask__detail">{card.detail.join("\n")}</div>}

      {card.question.length > 0 && <p className="ask__question">{card.question.join("\n")}</p>}

      {ask.taking === "words" ? (
        /* A question with no answers under it is answered by writing one. The
           return that submits it is the session's to send, so pressing it here
           and pressing it in the terminal are the same press. */
        <form
          className="ask__field nopan"
          onPointerDown={(event) => event.stopPropagation()}
          onSubmit={(event) => {
            event.preventDefault();
            reply(session, ask, written);
          }}
        >
          <input
            className="ask__written nodrag nopan"
            value={written}
            aria-label={t("ask.write")}
            placeholder={t("ask.write")}
            onChange={(event) => setWritten(event.target.value)}
          />
          <button type="submit" className="ask__send nodrag nopan" aria-label={t("ask.send")}>
            <KeyboardReturnIcon sx={{ fontSize: 13 }} />
          </button>
        </form>
      ) : (
        /* The answers, in the agent's own order. A key is drawn beside one only
           where the agent printed a key: it is drawn because it is also what
           would be typed at the terminal, and a list that is walked has nothing
           there to type. The one the agent is standing on is marked rather than
           made to look like the one to press — which answer its cursor is on is
           a fact about the terminal, and this card does not get to recommend
           anything. */
        <div className="ask__choices">
          {card.choices.map((choice) => (
            <button
              key={choice.key}
              type="button"
              className={`ask__choice nopan${choice.selected ? " is-here" : ""}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                answer(session, ask, choice.key);
              }}
            >
              {ask.taking === "walk" ? (
                <span className="ask__mark" aria-hidden="true">
                  {choice.selected ? "❯" : ""}
                </span>
              ) : (
                <span className="ask__key">{choice.key}</span>
              )}
              <span className="ask__answer">{choice.lines.join("\n")}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
