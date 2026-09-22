import { Box } from "@mui/material";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef, useState } from "react";
import { copyText } from "../lib/clipboard";
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

// Meta Return: what Alt+Return sends, read by agents as a line break.
const ANOTHER_LINE = "\x1b\r";

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

const FONT = 12;
// On the emulator's own element, the one place the fit addon subtracts it.
const PAD = { x: 8, y: 4 };
// Reserved beside the text as the overview ruler's width, which is what the fit addon takes
// off whether or not a bar is drawn; the slider is dressed inside it by canvas/styles/terminal.css.
const SCROLLBAR = 7;
// Ctrl+V on the wire, which agents read as a picture paste.
const PASTE_KEY = "\x16";

type Props = {
  session: Session;
  shown: boolean;
  onEnded: () => void;
  /** Drawn this many times larger and scaled back, so a zoomed page does not stretch xterm's canvas. */
  scale?: number;
};

// The selection leaves through the browser's own copy command while the key is still down: it
// asks no permission, and xterm's copy listener supplies the selected text. The field is filled
// first because the command is refused over an empty one. The clipboard helper is the fallback.
function copySelection(terminal: Terminal): void {
  const selected = terminal.getSelection();
  if (!selected) return;
  const field = terminal.textarea;
  let copied = false;
  if (field) {
    field.value = selected;
    field.select();
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    field.value = "";
  }
  if (!copied) void copyText(selected).catch(() => undefined);
}

export function CliView({ session, shown, onEnded, scale = 1 }: Props) {
  // State, not a ref: a view update can swap the node, and the effect must re-attach.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const drawn = useRef<Terminal | null>(null);
  const palette = usePalette();
  const [failed, setFailed] = useState(false);

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

  // Refs, so a rebuilt callback never rebuilds the terminal and loses its scrollback.
  const ended = useRef(onEnded);
  useEffect(() => {
    ended.current = onEnded;
  }, [onEnded]);
  const drawnAt = useRef(scale);
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
      overviewRuler: { width: SCROLLBAR },
      linkHandler: { activate: openTerminalLink },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon(openTerminalLink));
    // Sixel and iTerm2 inline images; storage held small because there are several terminals.
    terminal.loadAddon(new ImageAddon({ storageLimit: 32 }));
    terminal.open(element);
    drawn.current = terminal;
    const stateKey = `terminal.${session.id}`;
    const forget = readOnSnapshot(stateKey, () => ({
      scroll: terminal.buffer.active.viewportY,
      selection: terminal.getSelectionPosition(),
    }));

    // The DOM renderer builds an element per cell; WebGL is optional and falls back.
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

    let lastGrid: { rows: number; cols: number } | null = null;
    const tell = (grid: { rows: number; cols: number }) => {
      if (lastGrid?.rows === grid.rows && lastGrid.cols === grid.cols) return;
      lastGrid = grid;
      void resizeShell(session.id, grid.rows, grid.cols).catch(() => undefined);
    };

    const measure = () => {
      const face = FONT * drawnAt.current;
      if (terminal.options.fontSize !== face) terminal.options.fontSize = face;
      fit.fit();
      const { rows, cols } = terminal;
      tell({ rows, cols });
    };

    settle.current = () => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return;
      measure();
    };
    if (element.clientWidth > 0 && element.clientHeight > 0) fit.fit();

    let live = true;
    terminal.onData((data) => void writeShell(session.id, data).catch(() => undefined));

    // A picture-only paste has no way into xterm's field; ^V lets the agent read the clipboard itself.
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

    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const plain = !event.altKey && !event.metaKey;

      if (plain && event.shiftKey && !event.ctrlKey && event.key === "Enter") {
        // preventDefault as well: xterm reads the key twice, at the press and as the character.
        event.preventDefault();
        void writeShell(session.id, ANOTHER_LINE).catch(() => undefined);
        return false;
      }

      // Ctrl+C copies over a selection and interrupts otherwise; the selection is cleared so the
      // next press interrupts.
      if (
        plain &&
        event.ctrlKey &&
        event.key.toLowerCase() === "c" &&
        (event.shiftKey || terminal.hasSelection())
      ) {
        event.preventDefault();
        copySelection(terminal);
        terminal.clearSelection();
        return false;
      }

      // Refused without preventDefault: the window's own paste then reaches xterm's field, bracketed.
      if (plain && event.ctrlKey && event.key.toLowerCase() === "v") return false;

      // Ctrl+digit, Ctrl+arrow, Ctrl+A and Ctrl+Alt+A are the window's keys.
      const digit = event.key.length === 1 && event.key >= "0" && event.key <= "9";
      if (plain && event.ctrlKey && !event.shiftKey && digit) return false;

      if (plain && event.ctrlKey && ARROWS.has(event.key)) return false;

      if (
        event.ctrlKey &&
        event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === "a"
      ) {
        return false;
      }

      if (plain && event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "a") {
        return false;
      }

      // Ctrl+Shift+Enter takes the offer stood on and Ctrl+Shift+A a new workspace.
      if (
        plain &&
        event.ctrlKey &&
        event.shiftKey &&
        (event.key === "Enter" || event.key.toLowerCase() === "a")
      ) {
        return false;
      }

      return true;
    });

    // Data heard before the backlog arrives is held and replayed after it.
    let reached: number | null = null;
    const waiting: Said[] = [];
    const say = (said: Said) => {
      if (reached === null) waiting.push(said);
      else if (said.seq >= reached) terminal.write(said.data);
    };

    const incoming = listen<Said>(DATA_EVENT, (event) => {
      if (event.payload.id === session.id) say(event.payload);
    });
    const finished = listen<string>(EXIT_EVENT, (event) => {
      if (event.payload === session.id && live) ended.current();
    });

    void readyAfter(
      (async () => {
        // Listen first: registering is itself an IPC round trip, and the backlog only covers the gap in this order.
        await Promise.all([incoming, finished]);
        if (!live) return;

        try {
          await startShell(session);
        } catch {
          if (live) setFailed(true);
          return;
        }
        if (!live) return;

        const held = await attachShell(session.id).catch(() => null);
        if (!live) return;
        if (!held) {
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

        tell({ rows: terminal.rows, cols: terminal.cols });
      })(),
    );

    const resize = new ResizeObserver(() => settle.current?.());
    resize.observe(element);

    return () => {
      live = false;
      drawn.current = null;
      settle.current = null;
      resize.disconnect();
      element.removeEventListener("paste", onPaste, true);
      void incoming.then((stop) => stop());
      void finished.then((stop) => stop());
      // The shell is left running; closing the session is what ends it.
      terminal.dispose();
      forget();
    };
  }, [host, session.id, session.cwd]);

  // Told rather than rebuilt: a rebuilt terminal loses its scrollback.
  useEffect(() => {
    const terminal = drawn.current;
    if (terminal) terminal.options.theme = colours;
  }, [colours]);

  const wheel = useWheel("cli");
  useEffect(() => {
    const terminal = drawn.current;
    if (terminal) terminal.options.scrollSensitivity = wheel / 100;
  }, [wheel]);

  useEffect(() => {
    drawnAt.current = scale;
    settle.current?.();
  }, [scale]);
  useEffect(() => {
    if (shown && host) drawn.current?.focus();
  }, [shown, host]);

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
        // xterm paints its viewport black over the padding; cleared so the box shows through.
        "& .xterm-viewport": { background: "transparent" },
      }}
    />
  );
}
