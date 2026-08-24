import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
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
 * Every answer is in two halves rather than one, and that is the whole of what
 * makes this a card a question can be worked at rather than only finished at.
 * The agent's own column — the key, the mark, the box — does at that answer
 * what pressing that column does at the terminal: walks the mark to it, or, on
 * a list several answers may be taken from, picks it up and puts it down
 * again. The words beside it take the answer, as they always did.
 *
 * Two kinds of question carry a row of their own under the answers, because
 * two kinds are not over when an answer is pressed. A list several answers are
 * picked up from is answered by one return under the lot of them, so pressing
 * an answer there walks to it rather than taking it. And a list whose mark is
 * standing in a row that is being written at carries the place to write, since
 * that is where the words go — though pressing an answer still takes it, the
 * session knowing that a key at such a list would be a letter and walking
 * instead. None of that is worked out here.
 *
 * Which is the rule the whole card is built on: no press invents a keystroke.
 * Each one names an act at the session, and what comes back is the agent's own
 * next drawing of the same question — the mark somewhere else, a box filled
 * in, words in a row — which is what is then shown. A card that drew what it
 * had asked for would be a card saying something the terminal had not done.
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

  /**
   * Whether the question carries a row of its own under the answers.
   *
   * A list several answers are picked up from needs the return that ends it,
   * and a list whose mark is standing in a row being written at needs the place
   * to write. Neither is a question that pressing one answer finishes in the
   * ordinary way.
   */
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
