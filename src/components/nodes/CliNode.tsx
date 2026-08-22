import CloseIcon from "@mui/icons-material/Close";
import TerminalIcon from "@mui/icons-material/Terminal";
import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { agentOf } from "../../lib/agents";
import type { CliFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

/**
 * One terminal: the only mark this canvas draws for anything to do with a
 * shell.
 *
 * A branch carries a stack of these, centred on the branch's own line and read
 * downwards — what is running in it, oldest first. Nothing stands here for the
 * terminal a branch has not opened yet: that offer is the button on the
 * branch's own ring, and pressing it puts the first of these on the canvas. So
 * the stack is exactly what is running, it opens out either way rather than
 * growing downwards, and the branch's own line stays the middle of it.
 *
 * The mark is the terminal glyph and nothing else. There is no box round it and
 * no paper under it: a square drawn round every one of these made a column of
 * boxes, which reads as a list of labels rather than as one kind of thing in
 * one place, and the box was the part of it doing the reading. What is left
 * says everything the box was there for — what it is is the glyph, whose it is
 * is what hangs off it, and what it is doing is its colour.
 *
 * Two states, and no third:
 *
 *   - this window's own, which shows itself in the panel and carries the one
 *     mark that ends it. The one the panel is holding wears a green dot on the
 *     corner of its glyph as well: the panel says which session it is showing,
 *     but it cannot say where out here that session is standing, and a stack is
 *     one glyph drawn over and over;
 *   - somebody else's, which cannot be pressed at all and carries what the
 *     sweep knows about it instead.
 */

/* What a terminal is doing, keyed the way the sweep reports it. The words are
   in the catalogues; this is only the road from one to the other, and it is a
   table rather than a template so a key that goes missing is a type error. */
const ACTIVITY = {
  busy: "cli.activity.busy",
  idle: "cli.activity.idle",
  waiting: "cli.activity.waiting",
  unknown: "cli.activity.unknown",
} as const;

export function CliNode({ data }: NodeProps<CliFlowNode>) {
  const { t } = useTranslation();
  const { session, cli, showing, ordinal, colour, carrying } = data;
  const { showSession, endSession } = useGraphActions();

  // Nowhere on the mark, and nowhere else on the canvas either: this is what
  // something reading the window aloud is given in place of the marks.
  const tool = cli ? agentOf(cli.tool) : session?.agent ? agentOf(session.agent) : null;
  const label = tool ? tool.label : t("cli.shell");
  const activity = cli ? t(ACTIVITY[cli.activity]) : null;
  const name = [
    label,
    ordinal ? `${ordinal}` : null,
    cli?.name,
    activity,
    carrying > 0 ? `+${carrying}` : null,
  ]
    .filter((part) => part)
    .join(" — ");

  return (
    <div className="cell cli">
      <div className="mark mark--centred cli__row">
        {/* This window's own is the one that answers to a press; a terminal
            somebody else opened is a reading and nothing more, so it is not a
            button and a drag beginning on it pans the canvas the way a drag
            beside it does. */}
        {session ? (
          <button
            type="button"
            className="cli__open nopan"
            style={{ color: colour }}
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
        ) : (
          <span
            className="cli__open"
            style={{ color: colour }}
            role="img"
            aria-label={name}
            title={name}
            data-cli-key={cli?.key}
          >
            <TerminalIcon sx={{ fontSize: 11 }} />
          </span>
        )}

        {/* Which of them the panel is holding. On the corner of the glyph
            rather than under it, because the corner is the one side of the
            mark nothing else hangs off — the count and the state are below,
            the mark that ends the session is out to the right — and because
            this is a thing about the mark itself rather than about what the
            terminal is doing. */}
        {showing && <span className="cli__live" />}

        {/* What the sweep knows, set under the glyph: what the terminal is
            doing, and how many agents it is running inside itself. Under rather
            than beside, because the line from the branch arrives on the left
            and the mark that ends a session stands on the right — and because a
            number that pushed the glyph along would take it off the line the
            rest of the stack is read down.

            Only a process the sweep knows has either: a session it has not
            caught up with yet has nothing honest to say. And only a terminal
            with something running inside it carries the count — a nil drawn on
            every mark would be a column of noughts, and the thing worth seeing
            is the one that is not empty. */}
        {cli && (
          <span className="cli__foot">
            <span className={`cli__state is-${cli.activity}`} />
            {carrying > 0 && <span className="chip__count">{carrying}</span>}
          </span>
        )}

        {/* The one thing here that cannot be undone, so it is faint until the
            pointer is on the mark. Its room is always held, so a stack does not
            shuffle sideways as the pointer runs down it. */}
        {session && (
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
        )}
      </div>
    </div>
  );
}
