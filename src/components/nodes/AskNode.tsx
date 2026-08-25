import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import type { NodeProps } from "@xyflow/react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AskFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

/**
 * A question something running in a terminal has stopped to ask, and the answers
 * to it.
 *
 * The one card this canvas grows by itself, and the one thing on it that is
 * words rather than a mark. It is drawn the same way every time — what it is
 * about, then the question, then the answers down the foot of it — because from
 * across a canvas that shape has to mean somebody is waiting.
 *
 * Every answer is in two halves: the agent's own column does at that answer what
 * pressing that column does at the terminal — walks the mark to it, or picks it
 * up — and the words beside it take the answer. Two kinds of question carry a
 * row of their own under the answers, because two kinds are not over when an
 * answer is pressed.
 *
 * The rule the whole card is built on: no press invents a keystroke. Each names
 * an act at the session, and what is shown is the agent's own next drawing of
 * the same question.
 *
 * The words in it are already broken to width by the layout, and the width is
 * the question's own — as wide as its longest line wanted, within what a card
 * may be. Nothing is measured here: the canvas needs the size of this card
 * before it can place it, and a card that decided its own would be one the
 * graph had to be rebuilt for after it had been drawn.
 */
export function AskNode({ data }: NodeProps<AskFlowNode>) {
  const { t } = useTranslation();
  const { session, ask, card } = data;
  const { answer, reply, point, pick, compose, take, showSession } = useGraphActions();

  /** Whether the question carries a row of its own under the answers: a list
   *  several answers are picked up from needs the return that ends it, and one
   *  being written at needs the place to write. */
  const working = ask.picking || ask.writing;

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
        <>
          {/* The answers, in the agent's own order, each of them in two parts.
              The agent's own column first — a key where the agent printed one,
              its mark where it printed no keys, a box where several answers may
              be taken — which is pressed to do at the answer what pressing that
              column does at the terminal. Then the words, which are pressed to
              take it. The one the agent is standing on is marked rather than
              made to look like the one to press: which answer its cursor is on
              is a fact about the terminal, and this card does not get to
              recommend anything. */}
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
                <button
                  type="button"
                  className="ask__answer nopan"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => {
                    event.stopPropagation();
                    // On a list the answers are picked up from, pressing one
                    // of them walks the mark there and stops: every key at
                    // such a list is a picking up, and what ends it is the
                    // return under the answers.
                    if (ask.picking) point(session, ask, choice.key);
                    else answer(session, ask, choice.key);
                  }}
                >
                  {choice.lines.join("\n")}
                </button>
              </div>
            ))}
          </div>

          {/* And the row that ends the two kinds of question no answer ends:
              what is written at the row the mark is standing in, and the
              return that takes the lot of it. */}
          {working && (
            <div className="ask__work nopan" onPointerDown={(event) => event.stopPropagation()}>
              {ask.writing && (
                <form
                  className="ask__writing"
                  onSubmit={(event) => {
                    event.preventDefault();
                    compose(session, ask, written);
                    // The words are at the session now, and the row they went
                    // into is the agent's to draw. What is left here is a draft
                    // of something already sent.
                    setWritten("");
                  }}
                >
                  <input
                    className="ask__written nodrag nopan"
                    value={written}
                    aria-label={t("ask.compose")}
                    placeholder={t("ask.compose")}
                    onChange={(event) => setWritten(event.target.value)}
                  />
                  <button
                    type="submit"
                    className="ask__send nodrag nopan"
                    aria-label={t("ask.send")}
                  >
                    <ArrowForwardIcon sx={{ fontSize: 13 }} />
                  </button>
                </form>
              )}
              <button
                type="button"
                className={`ask__take nodrag nopan${ask.writing ? "" : " is-wide"}`}
                aria-label={t("ask.take")}
                onClick={(event) => {
                  event.stopPropagation();
                  take(session, ask);
                }}
              >
                <KeyboardReturnIcon sx={{ fontSize: 13 }} />
                {!ask.writing && <span className="ask__taking">{t("ask.take")}</span>}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
