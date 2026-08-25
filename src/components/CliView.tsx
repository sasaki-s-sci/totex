import { Box } from "@mui/material";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  attachShell,
  DATA_EVENT,
  EXIT_EVENT,
  resizeShell,
  type Said,
  startShell,
  writeShell,
} from "../lib/pty";
import type { Session } from "../lib/session";
import { usePalette } from "../theme";

import "@xterm/xterm/css/xterm.css";

/** The Return that means another line rather than the end of one: the meta
 *  Return, which is what a terminal has always sent for Alt+Return and what the
 *  agents already read as "one more line, not yet". */
const ANOTHER_LINE = "\x1b\r";

/** The four keys the window walks itself with, which it takes from the shell:
 *  wherever they are typed they are about leaving here. */
const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

type Props = {
  session: Session;
  /** Whether this is the one the panel is showing. */
  shown: boolean;
  /** The shell finished, so there is nothing left in here to look at. */
  onEnded: () => void;
};

/**
 * A shell, in the directory of the branch it was opened from.
 *
 * The process is not this component's: what happens here is an attachment — the
 * terminal says it is listening, is handed everything the shell has said so far,
 * and draws the rest as it arrives. The terminal itself is driven imperatively,
 * because it owns a canvas and a scrollback React must not re-render.
 */
export function CliView({ session, shown, onEnded }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const drawn = useRef<Terminal | null>(null);
  const palette = usePalette();
  // A shell that never came up. Nothing is written about it — the panel is
  // there, the terminal in it is empty, and the edge along the top is red.
  const [failed, setFailed] = useState(false);

  // The colours the rows are drawn in, read through `usePalette` because a
  // terminal is not CSS. Held apart from the terminal because the two do not
  // change together: one rebuilt for a palette change would lose its scrollback.
  const colours = useMemo(
    () => ({
      background: palette.background.paper,
      foreground: palette.text.primary,
      cursor: palette.primary.main,
      cursorAccent: palette.background.paper,
      selectionBackground: palette.action.selected,
    }),
    [palette.background.paper, palette.text.primary, palette.primary.main, palette.action.selected],
  );

  // Read through a ref rather than captured: the effect below builds a terminal,
  // and re-running it because a callback was rebuilt would throw away the
  // scrollback along with it.
  const ended = useRef(onEnded);
  useEffect(() => {
    ended.current = onEnded;
  }, [onEnded]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the session is the identity; the colours are read once here and kept up to date below
  useEffect(() => {
    const element = host.current;
    if (!element) return;

    const terminal = new Terminal({
      fontSize: 12,
      fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
      cursorBlink: true,
      theme: colours,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    drawn.current = terminal;

    // What xterm falls back to draws every cell as an element of its own, which
    // an agent redrawing a whole screen makes expensive. Not always there, and
    // the fallback is what happens then, so neither case is worth failing over.
    let accelerated: WebglAddon | null = null;
    try {
      accelerated = new WebglAddon();
      accelerated.onContextLoss(() => {
        accelerated?.dispose();
        accelerated = null;
      });
      terminal.loadAddon(accelerated);
    } catch {
      accelerated = null;
    }

    fit.fit();

    let live = true;
    terminal.onData((data) => void writeShell(session.id, data).catch(() => undefined));

    // The keystrokes that mean something here they do not mean to a shell, taken
    // before xterm reads them. Everything else is the terminal's own.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      // Alt and the window key are nobody's business here: whatever they are
      // held down for, it is not one of these two.
      const plain = !event.altKey && !event.metaKey;

      // Shift+Return, which xterm would send as a plain Return and the agent
      // would run. Put on the wire as the Return that only breaks the line.
      if (plain && event.shiftKey && !event.ctrlKey && event.key === "Enter") {
        // Refused twice, because xterm reads the key twice: what it is told to
        // leave alone at the press it picks up again as the character. A press
        // nobody let through never becomes a character.
        event.preventDefault();
        void writeShell(session.id, ANOTHER_LINE).catch(() => undefined);
        return false;
      }

      // Ctrl and a number, which is how one terminal is left for another: the
      // window answers it, so the shell must not. A few of these are control
      // characters nobody has typed on purpose in years.
      const digit = event.key.length === 1 && event.key >= "0" && event.key <= "9";
      if (plain && event.ctrlKey && !event.shiftKey && digit) return false;

      // Ctrl and an arrow, the other way out: the terminals with Ctrl alone, the
      // canvas with Shift held as well. What the shell gives up is the word its
      // cursor used to jump over.
      if (plain && event.ctrlKey && ARROWS.has(event.key)) return false;

      return true;
    });

    // Everything the session says from here on, held until the backlog it has to
    // go in after has arrived.
    let reached: number | null = null;
    const waiting: Said[] = [];
    const say = (said: Said) => {
      if (reached === null) waiting.push(said);
      else if (said.seq >= reached) terminal.write(said.data);
    };

    const incoming = listen<Said>(DATA_EVENT, (event) => {
      if (event.payload.id === session.id) say(event.payload);
    });
    // A shell that exits takes the panel with it: a dead terminal has nothing
    // left to read, and closing it by hand afterwards is a step that never
    // decides anything.
    const finished = listen<string>(EXIT_EVENT, (event) => {
      if (event.payload === session.id && live) ended.current();
    });

    // What the shell was last told it had. Dragging the panel's edge reports a
    // resize every frame, and the character grid only changes every so many of
    // them — the rest would be a crossing into Rust to say nothing.
    let told = { rows: terminal.rows, cols: terminal.cols };

    void (async () => {
      // Listening first, and waited for: registering a listener is itself a
      // crossing into Rust, and the backlog only covers the gap in this order.
      await Promise.all([incoming, finished]);
      if (!live) return;

      try {
        // Ordinarily already running, because opening the session started it.
        // This is for the one that is not: a start that failed, or a session
        // this window has only just been told about.
        await startShell(session);
      } catch {
        if (live) setFailed(true);
        return;
      }
      if (!live) return;

      const held = await attachShell(session.id).catch(() => null);
      if (!live) return;
      if (!held) {
        // Nothing to attach to: it ended in the moment between being started
        // and being drawn, and the exit went past before anyone was listening.
        ended.current();
        return;
      }

      terminal.write(held.text);
      reached = held.upto;
      for (const said of waiting) say(said);
      waiting.length = 0;

      // The shell was started at a size nothing had measured, so the first
      // thing a terminal that exists tells it is how much room it really has.
      told = { rows: terminal.rows, cols: terminal.cols };
      void resizeShell(session.id, told.rows, told.cols).catch(() => undefined);
    })();

    // The panel is resizable, and a shell that is not told its size draws
    // anything full-screen at the wrong one.
    const resize = new ResizeObserver(() => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return;
      fit.fit();
      const { rows, cols } = terminal;
      if (rows === told.rows && cols === told.cols) return;
      told = { rows, cols };
      void resizeShell(session.id, rows, cols).catch(() => undefined);
    });
    resize.observe(element);

    return () => {
      live = false;
      drawn.current = null;
      resize.disconnect();
      void incoming.then((stop) => stop());
      void finished.then((stop) => stop());
      terminal.dispose();
      // The shell is deliberately left running: what it says with no terminal
      // there is kept for whichever asks next. Closing the session is what ends it.
    };
  }, [session.id, session.cwd]);

  // A terminal keeps its own copy of the colours it was built with, so a palette
  // change is told rather than rebuilt: the same rows in a different colour.
  useEffect(() => {
    const terminal = drawn.current;
    if (terminal) terminal.options.theme = colours;
  }, [colours]);

  // The keyboard follows the panel. Coming back to a terminal is coming back to
  // something to type into, and a click into the rows to say so is a step that
  // decides nothing.
  useEffect(() => {
    if (shown) drawn.current?.focus();
  }, [shown]);

  return (
    <Box
      ref={host}
      sx={{
        flex: 1,
        minHeight: 0,
        px: 1,
        py: 0.5,
        borderTop: 2,
        borderColor: failed ? "error.main" : "transparent",
      }}
    />
  );
}
