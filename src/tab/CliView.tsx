import { Box } from "@mui/material";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef, useState } from "react";
import { gridOf, subscribeGrid, tellGrid } from "../lib/cliGrid";
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
import { openTerminalLink } from "../lib/terminalLinks";
import { useWheel, wheelFactor } from "../lib/wheel";
import { readyAfter } from "../shell/bridge";
import { frontValue, readOnSnapshot } from "../shell/state";
import { usePalette } from "../theme";

import "@xterm/xterm/css/xterm.css";

/** The Return that means another line rather than the end of one: the meta
 *  Return, which is what a terminal has always sent for Alt+Return and what the
 *  agents already read as "one more line, not yet". */
const ANOTHER_LINE = "\x1b\r";

/** The four keys the window walks itself with, which it takes from the shell:
 *  wherever they are typed they are about leaving here. */
const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

/** The face the rows are read in, at full size. */
const FONT = 12;
/** The air round the rows, inside the box. On the emulator's own element,
 *  which is the one place the fit addon subtracts it from. */
const PAD = { x: 8, y: 4 };
/** What the emulator keeps on the right for the scrollbar — its own figure,
 *  which the fit addon takes off the width whether or not one is drawn. */
const SCROLLBAR = 14;
/** The smallest face a terminal that follows another is drawn in. Past this
 *  the rows are a texture, and a texture says nothing worth the pixels. */
const LEAST_FONT = 5;
/** The character an agent reads as the paste of a picture: Ctrl and V, on the
 *  wire, which is what reached it before the window took the press for text. */
const PASTE_KEY = "\x16";

type Props = {
  session: Session;
  /** Whether this is the one the panel is showing. */
  shown: boolean;
  /** The shell finished, so there is nothing left in here to look at. */
  onEnded: () => void;
  /**
   * How many times larger than its box the rows are drawn, before the box is
   * scaled back down by the same amount — which is what a terminal standing on
   * a zoomed canvas asks for. The emulator draws to a canvas, and a canvas is
   * drawn once at its own size and stretched to whatever scale it is shown at:
   * at anything but full size the rows are that drawing stretched. Drawn
   * larger and scaled down, the stretch comes to one, and the rows are drawn
   * at the pixels they are shown at. Full size by default, which is the panel.
   */
  scale?: number;
  /**
   * Another drawing of this shell is the one that measures it. This one draws
   * the rows and columns that one settled on, in as small a face as it takes
   * to fit them, and never tells the shell a size of its own — see `cliGrid`.
   */
  follow?: boolean;
  /** Take the keys as soon as it is drawn, whether or not it is the one shown. */
  autoFocus?: boolean;
};

/** The size the rows are drawn at, for a box this large. */
function faceFor(
  grid: { rows: number; cols: number },
  cell: { w: number; h: number },
  room: { w: number; h: number },
): number {
  const size = Math.min(FONT, room.w / (grid.cols * cell.w), room.h / (grid.rows * cell.h));
  return Math.max(LEAST_FONT, Math.floor(size * 4) / 4);
}

/**
 * A shell, in the directory of the branch it was opened from.
 *
 * The process is not this component's: what happens here is an attachment — the
 * terminal says it is listening, is handed everything the shell has said so far,
 * and draws the rest as it arrives. The terminal itself is driven imperatively,
 * because it owns a canvas and a scrollback React must not re-render.
 */
export function CliView({
  session,
  shown,
  onEnded,
  scale = 1,
  follow = false,
  autoFocus = false,
}: Props) {
  // A view update can replace this DOM node without remounting the controller.
  // Reattach to the running shell whenever the actual drawing surface changes.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
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
  // Read through refs for the same reason, and settled below whenever either
  // changes: the terminal is the same terminal at any scale and in either role.
  const drawnAt = useRef(scale);
  const following = useRef(follow);
  /** Fits the rows to the box, or to the grid being followed, as the role says. */
  const settle = useRef<(() => void) | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the session is the identity; the colours are read once here and kept up to date below
  useEffect(() => {
    const element = host;
    if (!element) return;
    setFailed(false);

    const terminal = new Terminal({
      fontSize: FONT * drawnAt.current,
      fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
      cursorBlink: true,
      theme: colours,
      scrollSensitivity: wheelFactor("cli"),
      linkHandler: { activate: openTerminalLink },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon(openTerminalLink));
    // Pictures drawn into the terminal by whatever is running in it, in the
    // two ways a program has of doing that: Sixel, which is the terminal's own
    // protocol and what `img2sixel`, `chafa` and the plotting libraries send,
    // and iTerm2's inline images, which is what `imgcat` sends. The addon
    // answers the terminal's own questions about it too -- a program asks
    // whether Sixel is drawn here before it draws any -- so nothing else has
    // to say so. Held to a fraction of the memory the addon would take by
    // default: this is one of several terminals in one window.
    terminal.loadAddon(new ImageAddon({ storageLimit: 32 }));
    terminal.open(element);
    drawn.current = terminal;
    const stateKey = `terminal.${session.id}`;
    const forget = readOnSnapshot(stateKey, () => ({
      scroll: terminal.buffer.active.viewportY,
      selection: terminal.getSelectionPosition(),
    }));

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

    // What the shell was last told it had. Dragging the panel's edge reports a
    // resize every frame, and the character grid only changes every so many of
    // them — the rest would be a crossing into Rust to say nothing.
    let told = { rows: terminal.rows, cols: terminal.cols };

    /** The grid another terminal settled on, drawn in a face that fits it here. */
    const shadow = () => {
      const grid = gridOf(session.id);
      // Nobody has measured the shell yet: the rows fit the box, and the shell
      // is not told — whoever measures first will.
      if (!grid) {
        fit.fit();
        return;
      }
      if (terminal.rows !== grid.rows || terminal.cols !== grid.cols) {
        terminal.resize(grid.cols, grid.rows);
      }
      // The emulator sets its screen to exactly the rows and columns it draws,
      // so the screen's size over the grid is the cell, and the cell over the
      // face is what one point of face costs — which is what says how large a
      // face this box can hold that many cells at.
      const screen = element.querySelector<HTMLElement>(".xterm-screen");
      const face = terminal.options.fontSize ?? FONT;
      if (!screen || screen.clientWidth === 0 || screen.clientHeight === 0) return;
      const cell = {
        w: screen.clientWidth / terminal.cols / face,
        h: screen.clientHeight / terminal.rows / face,
      };
      const room = {
        w: element.clientWidth - PAD.x * 2 - SCROLLBAR,
        h: element.clientHeight - PAD.y * 2,
      };
      const next = faceFor(grid, cell, room);
      if (Math.abs(next - face) > 0.01) terminal.options.fontSize = next;
    };

    /** The rows fitted to the box, and the shell told when that changed it. */
    const measure = () => {
      const face = FONT * drawnAt.current;
      if (terminal.options.fontSize !== face) terminal.options.fontSize = face;
      fit.fit();
      const { rows, cols } = terminal;
      if (rows === told.rows && cols === told.cols) return;
      told = { rows, cols };
      void resizeShell(session.id, rows, cols).catch(() => undefined);
      tellGrid(session.id, told);
    };

    settle.current = () => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return;
      if (following.current) shadow();
      else measure();
    };
    if (following.current) shadow();
    else fit.fit();

    let live = true;
    terminal.onData((data) => void writeShell(session.id, data).catch(() => undefined));

    // A paste with a picture in it and no text. The window pastes text into
    // the terminal's own field, where the emulator reads it; a picture has no
    // way in by that door, and the agent on the other end has one of its own —
    // it reads the clipboard itself when it is sent the Ctrl+V it was never
    // sent once the press was taken for text. Heard on the way down, before
    // the emulator's own listener, and only when there is no text to paste:
    // a paste that has both is the text, the way it is everywhere else.
    const onPaste = (event: ClipboardEvent) => {
      const carried = event.clipboardData;
      if (!carried) return;
      const text = carried.types.includes("text/plain");
      const file =
        carried.types.includes("Files") ||
        Array.from(carried.items).some((item) => item.kind === "file");
      if (text || !file) return;
      event.preventDefault();
      event.stopPropagation();
      void writeShell(session.id, PASTE_KEY).catch(() => undefined);
    };
    element.addEventListener("paste", onPaste, true);

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

      // Ctrl and C over a selection, which everywhere else on the desktop is
      // the copy. In here it is also the interrupt, and what tells the two
      // apart is whether anything is selected at all: nothing selected is the
      // press left to xterm, which sends the interrupt as it always has. The
      // selection is dropped as it is taken, so the press after a copy is the
      // interrupt again rather than a second copy of the same rows.
      //
      // Ctrl and Shift and C is the copy whether or not the interrupt would
      // have been wanted — the one to reach for while something is running.
      if (
        plain &&
        event.ctrlKey &&
        event.key.toLowerCase() === "c" &&
        (event.shiftKey || terminal.hasSelection())
      ) {
        event.preventDefault();
        const selected = terminal.getSelection();
        if (selected) void navigator.clipboard.writeText(selected).catch(() => undefined);
        terminal.clearSelection();
        return false;
      }

      // Ctrl and V, with Shift or without, which xterm would send as the ^V
      // nobody has typed on purpose. Refused without refusing the press itself:
      // a Ctrl+V nothing cancelled is pasted by the window into the terminal's
      // own field, and what arrives there is a paste the terminal already reads
      // — bracketed the way the shell asked for it, with the line endings a
      // shell can take. Asking the clipboard for the text ourselves would be
      // the same paste with a permission prompt in front of it.
      if (plain && event.ctrlKey && event.key.toLowerCase() === "v") return false;

      // Ctrl and a number, which is how one terminal is left for another: the
      // window answers it, so the shell must not. A few of these are control
      // characters nobody has typed on purpose in years.
      const digit = event.key.length === 1 && event.key >= "0" && event.key <= "9";
      if (plain && event.ctrlKey && !event.shiftKey && digit) return false;

      // Ctrl and an arrow, the other way out: the terminals with Ctrl alone, the
      // canvas with Shift held as well. What the shell gives up is the word its
      // cursor used to jump over.
      if (plain && event.ctrlKey && ARROWS.has(event.key)) return false;

      // Ctrl and Alt and A, which asks this one's own workspace what its
      // runners say can be run in it. Alt is held, so `plain` is false and none
      // of the rules above has answered it: what the shell gives up is an
      // escape and a letter, which is a line-editing key nobody has bound.
      if (
        event.ctrlKey &&
        event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "a"
      ) {
        return false;
      }

      // Ctrl and A, which opens another terminal in this one's own workspace.
      // What the shell gives up is the jump to the start of the line — Home is
      // still there, and a second terminal beside this one is worth more than a
      // second way of reaching a column.
      if (plain && event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "a") {
        return false;
      }

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

    void readyAfter(
      (async () => {
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

        await new Promise<void>((resolve) => terminal.write(held.text, resolve));
        if (!live) return;
        reached = held.upto;
        for (const said of waiting) say(said);
        waiting.length = 0;
        const before = frontValue<{
          scroll: number;
          selection?: { start: { x: number; y: number }; end: { x: number; y: number } };
        }>(stateKey);
        if (before) {
          terminal.scrollToLine(before.scroll);
          const range = before.selection;
          if (range)
            terminal.select(
              range.start.x,
              range.start.y,
              (range.end.y - range.start.y) * terminal.cols + range.end.x - range.start.x,
            );
        }

        // The shell was started at a size nothing had measured, so the first
        // thing a terminal that exists tells it is how much room it really has
        // — unless another terminal is the one that measures it.
        if (following.current) {
          shadow();
          return;
        }
        told = { rows: terminal.rows, cols: terminal.cols };
        void resizeShell(session.id, told.rows, told.cols).catch(() => undefined);
        tellGrid(session.id, told);
      })(),
    );

    // The panel is resizable, and a shell that is not told its size draws
    // anything full-screen at the wrong one.
    const resize = new ResizeObserver(() => settle.current?.());
    resize.observe(element);
    // And a terminal that follows another redraws when that one is resized.
    const heard = subscribeGrid(session.id, () => {
      if (following.current) settle.current?.();
    });

    return () => {
      live = false;
      drawn.current = null;
      settle.current = null;
      resize.disconnect();
      heard();
      element.removeEventListener("paste", onPaste, true);
      void incoming.then((stop) => stop());
      void finished.then((stop) => stop());
      terminal.dispose();
      forget();
      // The shell is deliberately left running: what it says with no terminal
      // there is kept for whichever asks next. Closing the session is what ends it.
    };
  }, [host, session.id, session.cwd]);

  // A terminal keeps its own copy of the colours it was built with, so a palette
  // change is told rather than rebuilt: the same rows in a different colour.
  useEffect(() => {
    const terminal = drawn.current;
    if (terminal) terminal.options.theme = colours;
  }, [colours]);

  // And so is how far a notch of the wheel takes it, which the settings page
  // changes while the terminal is still drawn.
  const wheel = useWheel("cli");
  useEffect(() => {
    const terminal = drawn.current;
    if (terminal) terminal.options.scrollSensitivity = wheel / 100;
  }, [wheel]);

  // The scale and the role are the terminal's to answer without being rebuilt:
  // a terminal rebuilt for either would lose its scrollback with it.
  useEffect(() => {
    drawnAt.current = scale;
    settle.current?.();
  }, [scale]);
  useEffect(() => {
    following.current = follow;
    settle.current?.();
  }, [follow]);

  // The keyboard follows the panel. Coming back to a terminal is coming back to
  // something to type into, and a click into the rows to say so is a step that
  // decides nothing. A page stood on the canvas takes them once, as it is drawn.
  const first = useRef(autoFocus);
  useEffect(() => {
    if ((shown || first.current) && host) drawn.current?.focus();
    first.current = false;
  }, [shown, host]);

  // The box fills whatever it is stood in, `scale` times over, and is scaled
  // back down from its top-left corner to fit — see `scale`. The failure is
  // said in an edge along the top that takes no room: the emulator measures
  // its rows from the box's height, and a border would be counted in it.
  return (
    <Box
      ref={setHost}
      data-terminal={session.id}
      data-terminal-shown={shown}
      sx={{
        position: "absolute",
        top: 0,
        left: 0,
        width: `${100 * scale}%`,
        height: `${100 * scale}%`,
        overflow: "hidden",
        transform: scale === 1 ? undefined : `scale(${1 / scale})`,
        transformOrigin: "0 0",
        boxShadow: failed ? "inset 0 2px 0 0 var(--mui-palette-error-main)" : "none",
        "& > .xterm": { padding: `${PAD.y}px ${PAD.x}px` },
        // The emulator's stylesheet paints its viewport black, and its viewport
        // is an empty layer over the whole box, padding and all: the rows are
        // drawn in another element inside the padding, in the theme's colour.
        // Left alone, that is a black edge around the rows in any palette that
        // is not black. Cleared, and the box shows through, which is the same
        // colour as the rows.
        "& .xterm-viewport": { background: "transparent" },
      }}
    />
  );
}
