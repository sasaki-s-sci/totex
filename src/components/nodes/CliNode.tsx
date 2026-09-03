import CloseIcon from "@mui/icons-material/Close";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { CliFlowNode } from "../../lib/graph";
import { useCliDoing } from "../cliDoing";
import { useCliJump } from "../cliJumps";
import { useCliPlace } from "../cliPlaces";
import { useTypedLine } from "../cliTyped";
import { useGraphActions } from "../graphActions";
import { CliGlyph } from "../marks";

/**
 * One terminal: the only mark this canvas draws for anything to do with a
 * shell.
 *
 * A branch carries a stack of these, centred on the branch's own line and read
 * downwards — what this window has open in it, oldest first. Nothing stands
 * here for the terminal a branch has not opened yet: that offer is the button
 * on the branch's own ring, and pressing it puts the first of these on the
 * canvas. So the stack is exactly what is running, it opens out either way
 * rather than growing downwards, and the branch's own line stays the middle of
 * it.
 *
 * The mark is the terminal glyph and nothing else. There is no box round it and
 * no paper under it: a square drawn round every one of these made a column of
 * boxes, which reads as a list of labels rather than as one kind of thing in
 * one place, and the box was the part of it doing the reading. What is left
 * says everything the box was there for — what it is is the glyph, and whose it
 * is is what hangs off it.
 *
 * Every one of them is this window's own, and there is no second kind. A
 * terminal opened somewhere else cannot be shown in the panel, typed into or
 * ended from here — a pty belongs to the process that made it — so a mark for
 * one would be a mark that answers to nothing, which on a canvas of things that
 * can be done is a reading pretending to be a place. What the window opened is
 * what the window draws.
 *
 * One of them carries a word: the terminal in the panel says, while Ctrl is
 * held, what it is running in. See `.cli__place`.
 */
export function CliNode({ id, data }: NodeProps<CliFlowNode>) {
  const { t } = useTranslation();
  const { session, showing, ordinal, group } = data;
  const { showSession, endSession } = useGraphActions();
  // What Ctrl and this number would reach, while Ctrl is being held. Drawn in
  // place of the glyph rather than beside it: the number is the whole of what
  // the mark is for while the key is down, and a mark carrying both would be
  // saying the one thing anybody already knows about it — that it is a
  // terminal — next to the one thing they are looking for.
  const jump = useCliJump(id);
  // And what this one was last told to do, while the same key is held, or all
  // the time where the window has been told to keep these. Beside the mark
  // rather than on it, in the place a card would stand — one terminal among a
  // stack of identical glyphs is told from the others by what somebody set it
  // going on, and that is a line of words rather than a mark.
  const said = useTypedLine(session.id);
  // And what it is doing, which is the one thing the glyph itself says. Three
  // states and three drawings — see `CliGlyph`, which is what the panel's band
  // draws from the same two readings.
  const doing = useCliDoing(session.id);
  // And what the terminal in the panel is running in — a repository or a folder
  // — which only that one is given, and only while the same key is down. The
  // key is what a stack is read with: every mark on it turns into a number to
  // go somewhere by, and the word says where the one being left is. It is on
  // the row it belongs to rather than in the run of them, so it is drawn where
  // every name on this canvas is drawn: on the line over its own mark.
  const place = useCliPlace(group);

  // Nowhere on the mark, and nowhere else on the canvas either: this is what
  // something reading the window aloud is given in place of the marks.
  const name = ordinal ? `${t("cli.shell")} ${ordinal}` : t("cli.shell");

  return (
    <div className="cell cli">
      <div className="mark mark--centred cli__row">
        {/* Where this one is running, over the mark and for the eye alone: the
            band it stands in is named on the canvas already, and the panel
            names it again over the run in its strip. */}
        {showing && jump !== null && place ? (
          <span className="cli__place" aria-hidden="true">
            {place}
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

        {/* The one thing here that cannot be undone, so it is faint until the
            pointer is on the mark. Its room is always held, so a stack does not
            shuffle sideways as the pointer runs down it. */}
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

        {/* Drawn for the eye running over a canvas and for nothing else: it is
            already said, in full and in its own terminal, to anything reading
            the window aloud. */}
        {said === null ? null : (
          <span className="cli__said" aria-hidden="true">
            {said}
          </span>
        )}
      </div>
    </div>
  );
}
