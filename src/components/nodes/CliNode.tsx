import CloseIcon from "@mui/icons-material/Close";
import TerminalIcon from "@mui/icons-material/Terminal";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { CliFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

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
 */
export function CliNode({ data }: NodeProps<CliFlowNode>) {
  const { t } = useTranslation();
  const { session, showing, ordinal } = data;
  const { showSession, endSession } = useGraphActions();

  // Nowhere on the mark, and nowhere else on the canvas either: this is what
  // something reading the window aloud is given in place of the marks.
  const name = ordinal ? `${t("cli.shell")} ${ordinal}` : t("cli.shell");

  return (
    <div className="cell cli">
      <div className="mark mark--centred cli__row">
        <button
          type="button"
          className="cli__open nopan"
          aria-label={name}
          aria-pressed={showing}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            showSession(session);
          }}
        >
          <TerminalIcon sx={{ fontSize: 11 }} />
        </button>

        {/* Which of them the panel is holding. On the corner of the glyph
            rather than under it, because the corner is the one side of the
            mark nothing else hangs off — the mark that ends the session is out
            to the right — and because this is a thing about the mark itself
            rather than about what the terminal is doing. */}
        {showing && <span className="cli__live" />}

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
      </div>
    </div>
  );
}
