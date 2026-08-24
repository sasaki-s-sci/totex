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

/**
 * The Return that means another line rather than the end of one.
 *
 * There is only one Return on the wire to a shell, and everything reading it
 * takes it for the end of what was being typed — so Shift+Return cannot be sent
 * as itself. What is sent instead is the Return with an escape in front of it:
 * the meta Return, which is what a terminal has always sent for Alt+Return and
 * what the agents run in here already read as "one more line, not yet".
 */
const ANOTHER_LINE = "\x1b\r";

/**
 * The four keys the window walks itself with, which it takes from the shell.
 *
 * Held with Ctrl they go from terminal to terminal, and with Shift as well they
 * walk the canvas the terminals are standing on — so wherever they are typed,
 * they are about leaving here rather than about anything in here.
 */
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
 * The process is not this component's — it was started with the session and
 * outlives every terminal built for it. What happens here is an attachment: the
 * terminal says it is listening, is handed everything the shell has said so
 * far, and draws the rest as it arrives. So a terminal built late comes up
 * holding the session's whole history rather than a blank screen in front of a
 * live shell, and one built twice is no different from one built once.
 *
 * The terminal itself is driven imperatively — it owns a canvas and a
 * scrollback that React must not re-render — so everything below the mount
 * effect talks to it directly rather than through state.
 */
export function CliView({ session, shown, onEnded }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const drawn = useRef<Terminal | null>(null);
  const palette = usePalette();
  // A shell that never came up. Nothing is written about it — the panel is
  // there, the terminal in it is empty, and the edge along the top is red.
  const [failed, setFailed] = useState(false);

  // The colours the rows are drawn in, which are the window's own. Read through
  // `usePalette` rather than off the theme, because a terminal is not CSS: what
  // is handed over here is a colour, and the theme object holds the light one
  // whichever half the window is showing.
  //
  // Held apart from the terminal because the two do not change together: the
  // window can be set to the other palette while a terminal is running, and a
  // terminal rebuilt to hear about it would be rebuilt without its scrollback.
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
    // an agent redrawing a whole screen makes expensive. This is not always
    // there — a machine without it, a driver taking the context back — and what
    // happens then is that fallback, so neither case is worth failing over.
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

    // The keystrokes that mean something in here they do not mean to a shell.
    // Every one of them is taken before xterm reads it; everything else — the
    // copy, the interrupt, the line the cursor is walked along — is the
    // terminal's own and is left alone.
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      // Alt and the window key are nobody's business here: whatever they are
      // held down for, it is not one of these two.
      const plain = !event.altKey && !event.metaKey;

      // Shift+Return, which xterm would send as a plain Return and the agent
      // would run. Put on the wire as the Return that only breaks the line, so
      // that a question worth several lines can be typed in the terminal the
      // same way it is typed anywhere else.
      if (plain && event.shiftKey && !event.ctrlKey && event.key === "Enter") {
        // Refused twice, because xterm reads the key twice: what it is told to
        // leave alone at the press it picks up again as the character, where a
        // Return with nothing but Shift held is a Return like any other and
        // goes down the wire as one — on top of the one written here, which is
        // the send this was meant to avoid. Ctrl used to be what kept it out
        // of there. Refusing the press outright is what keeps it out now: a
        // press nobody let through never becomes a character.
        event.preventDefault();
        void writeShell(session.id, ANOTHER_LINE).catch(() => undefined);
        return false;
      }

      // Ctrl and a number, which is how one terminal is left for another. The
      // window answers it — the mark wearing that number is on the graph, and
      // the panel comes back holding what it names — so the shell must not: a
      // few of these are control characters nobody has typed on purpose in
      // years, and the way out of a terminal is worth more than they are.
      // Refusing here is all it takes; the key carries on to the window.
      const digit = event.key.length === 1 && event.key >= "0" && event.key <= "9";
      if (plain && event.ctrlKey && !event.shiftKey && digit) return false;

      // Ctrl and an arrow, which is the other way out: the terminals with Ctrl
      // alone, the canvas behind them with Shift held as well. What the shell
      // gives up for it is the word its cursor used to jump over — a key worth
      // less, in a window whose terminals are the places being moved between.
      if (plain && event.ctrlKey && ARROWS.has(event.key)) return false;

      return true;
    });

    // Everything the session says from here on, held until it can be drawn in
    // the right place. The backlog is still being fetched, and what has just
    // been said has to go in after what was said before it — so it waits, and
    // then whatever the backlog did not already contain is written.
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
      // crossing into Rust, and everything the shell said while it was on its
      // way would arrive nowhere. The backlog is what covers that — but only
      // if the two are asked for in this order.
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
      // The shell is deliberately left running, and nothing it says while there
      // is no terminal for it is lost: it is kept for whichever terminal asks
      // next. Closing the session is what ends it, and that goes through the
      // graph.
    };
  }, [session.id, session.cwd]);

  // A terminal keeps its own copy of the colours it was built with, so the
  // window being set to the other palette is something it has to be told. Told
  // rather than rebuilt: what is on the screen is the session's whole history,
  // and it is the same rows in a different colour.
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
