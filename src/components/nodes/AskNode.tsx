import KeyboardReturnIcon from "@mui/icons-material/KeyboardReturn";
import type { NodeProps } from "@xyflow/react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { AskFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

/**
 * The one place a question is written at, wherever on the card it stands.
 *
 * Two of the four shapes are answered in words rather than by a press: a
 * question that is nothing but a line to type at, and the row of a list the
 * agent's own mark is standing in — the "and tell it what to do instead" every
 * agent offers. The same row is drawn for both, in the place the question put
 * it, because they are the same act: what is written, and the return that ends
 * the question.
 *
 * What is typed goes nowhere until it is sent. A card that wrote every letter
 * through to the session would be leaving an answer half given in the agent's
 * own field, and would be renaming the question with every keystroke — the row
 * it is typed into is one of the answers, and an answer that changes is a
 * different question to answer.
 */
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
  /** What the agent itself has in the row, which is what is being written over. */
  label: string;
  className: string;
  /** Whether this is a row that has just become a place to write. */
  focus: boolean;
}) {
  const { t } = useTranslation();
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // A row becomes a place to write because somebody walked the mark into it,
    // here or at the terminal, and what they did that for was to write in it.
    // Nothing is scrolled to: the canvas does not move under anybody for this.
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
 * up — and the words beside it take the answer. The row the mark is standing in
 * is drawn as a place to write when that is what the agent has made of it, and a
 * list several answers are picked up from carries the return that ends it.
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
  const { answer, reply, point, pick, take, showSession } = useGraphActions();

  /** What has been written at the question, until it is sent. */
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
        /* A question with no answers under it is answered by writing one. */
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
                {ask.writing && choice.selected ? (
                  /* The agent has made this row a place to type, so it is drawn
                     as one: the answer is written where it is being asked for
                     rather than under the list, and it is the answer — the
                     return that sends it is the one that ends the question. */
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
                )}
              </div>
            ))}
          </div>

          {/* And the return that ends the one kind of question no answer ends:
              a list the answers are picked up from, where every key is a picking
              up and the answer is the return under the lot of them. */}
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
