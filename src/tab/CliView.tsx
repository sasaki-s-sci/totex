import { Alert, Box } from "@mui/material";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "../lib/appSettings";
import { copyText, readClipboard } from "../lib/clipboard";
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
import { registerTerminalClipboard } from "../lib/terminalClipboard";
import { openTerminalLink } from "../lib/terminalLinks";
import { registerTerminalScroll } from "../lib/terminalScroll";
import { useWheel, wheelFactor } from "../lib/wheel";
import { ResumeBar } from "../resume/ResumeBar";
import { frontInactive, readyAfter } from "../shell/bridge";
import { frontValue, readOnSnapshot } from "../shell/state";
import { usePalette, useTerminalLook, withAlpha } from "../theme";

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
// The longest a hidden terminal's output waits for the window to be idle.
const UNSEEN_WAIT = 500;

type Props = {
  session: Session;
  shown: boolean;
  onEnded: () => void;
  /** Drawn this many times larger and scaled back, so a zoomed page does not stretch xterm's canvas. */
  scale?: number;
  compact?: boolean;
  viewer?: boolean;
  resize?: boolean;
  background?: "paper" | "default";
};

export function CliView({
  session,
  shown,
  onEnded,
  scale = 1,
  compact = false,
  viewer = false,
  resize = true,
  background = "paper",
}: Props) {
  // State, not a ref: a view update can swap the node, and the effect must re-attach.
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const drawn = useRef<Terminal | null>(null);
  const palette = usePalette();
  const look = useTerminalLook();
  const { t } = useTranslation();
  const [copyFailed, setCopyFailed] = useState(false);
  const [pasteFailed, setPasteFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  const opaque = palette.background[background];
  const surface = withAlpha(opaque, look.opacity);

  const colours = useMemo(
    () => ({
      background: surface,
      foreground: palette.text.primary,
      cursor: palette.primary.main,
      cursorAccent: opaque,
      selectionBackground: palette.action.selected,
      // The ruler under the scrollbar draws a 1px line down its left edge in this colour. Hex, since
      // xterm cannot parse the keyword `transparent` and falls back to white.
      overviewRulerBorder: "#00000000",
      ...look.ansi,
    }),
    [
      surface,
      opaque,
      palette.text.primary,
      palette.primary.main,
      palette.action.selected,
      look.ansi,
    ],
  );

  // Refs, so a rebuilt callback never rebuilds the terminal and loses its scrollback.
  const ended = useRef(onEnded);
  useEffect(() => {
    ended.current = onEnded;
  }, [onEnded]);
  const { terminalText } = useAppSettings();
  const drawnAt = useRef(scale);
  const compactAt = useRef(compact);
  const textAt = useRef(terminalText);
  const settle = useRef<(() => void) | null>(null);
  const showing = useRef(shown);
  const catchUpNow = useRef<(() => void) | null>(null);
  const resizeAt = useRef(resize);
  const reclaimSize = useRef<(() => void) | null>(null);

  useEffect(() => {
    resizeAt.current = resize;
    if (resize) reclaimSize.current?.();
  }, [resize]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the session is the identity; the colours are read once here and kept up to date below
  useEffect(() => {
    const element = host;
    if (!element) return;
    setFailed(false);
    setCopyFailed(false);
    setPasteFailed(false);

    const terminal = new Terminal({
      fontSize: (FONT * drawnAt.current * textAt.current) / 100,
      fontFamily: look.mono,
      allowTransparency: look.seeThrough,
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
    const scrollSpace = registerTerminalScroll(terminal, element);
    drawn.current = terminal;
    const stateKey = `terminal.${viewer ? "viewer." : ""}${session.id}`;
    const forget = readOnSnapshot(stateKey, () => ({
      scroll: terminal.buffer.active.viewportY,
      below: element.scrollTop,
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
      if (!resizeAt.current) return;
      if (lastGrid?.rows === grid.rows && lastGrid.cols === grid.cols) return;
      lastGrid = grid;
      void resizeShell(session.id, grid.rows, grid.cols).catch(() => undefined);
    };

    const measure = () => {
      const face = (FONT * drawnAt.current * textAt.current) / 100;
      if (terminal.options.fontSize !== face) terminal.options.fontSize = face;
      if (compactAt.current) {
        const proposed = fit.proposeDimensions();
        if (proposed) terminal.resize(proposed.cols, 2);
        const wrapper = element.closest<HTMLElement>(".resizable-page");
        const page = element.closest<HTMLElement>(".page");
        const header = page?.querySelector<HTMLElement>(".page__header");
        const screen = terminal.element?.querySelector<HTMLElement>(".xterm-screen");
        if (wrapper && page && screen && terminal.element && screen.clientHeight > 0) {
          const padding = getComputedStyle(terminal.element);
          const border = getComputedStyle(page);
          const height =
            (header?.offsetHeight ?? 0) +
            screen.getBoundingClientRect().height +
            (parseFloat(padding.paddingTop) + parseFloat(padding.paddingBottom)) / drawnAt.current +
            parseFloat(border.borderTopWidth) +
            parseFloat(border.borderBottomWidth);
          wrapper.style.setProperty("--compact-height", `${height}px`);
        }
      } else fit.fit();
      const { rows, cols } = terminal;
      tell({ rows, cols });
    };

    settle.current = () => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return;
      measure();
    };
    reclaimSize.current = () => {
      // Another view may have changed the PTY size since this view last owned it.
      lastGrid = null;
      settle.current?.();
    };
    if (element.clientWidth > 0 && element.clientHeight > 0) {
      fit.fit();
      if (compactAt.current) terminal.resize(terminal.cols, 2);
    }

    let live = true;
    let replaying = true;
    // Both views parse output, but only the size owner answers terminal queries.
    // A newly opened viewer must not answer queries from its historical backlog.
    const ignoreQuery = () => !resizeAt.current || (viewer && replaying);
    const queryHandlers = [
      ...[
        { final: "c" },
        { prefix: ">", final: "c" },
        { final: "n" },
        { prefix: "?", final: "n" },
        { intermediates: "$", final: "p" },
        { prefix: "?", intermediates: "$", final: "p" },
      ].map((id) => terminal.parser.registerCsiHandler(id, ignoreQuery)),
      terminal.parser.registerCsiHandler(
        { final: "t" },
        (params) => ignoreQuery() && [14, 16, 18, 20, 21].includes(Number(params[0])),
      ),
      terminal.parser.registerCsiHandler(
        { prefix: "?", final: "S" },
        (params) => ignoreQuery() && [1, 4].includes(Number(params[1])),
      ),
      terminal.parser.registerDcsHandler({ intermediates: "$", final: "q" }, ignoreQuery),
      ...[4, 10, 11, 12].map((id) =>
        terminal.parser.registerOscHandler(
          id,
          (data) => ignoreQuery() && data.split(";").includes("?"),
        ),
      ),
    ];
    const reportCopyFailure = (error: unknown) => {
      console.error("Could not copy terminal text", error);
      if (live) setCopyFailed(true);
    };
    const writeClipboard = async (text: string) => {
      await copyText(text);
      if (live) setCopyFailed(false);
    };
    const clipboard = registerTerminalClipboard(
      terminal,
      writeClipboard,
      reportCopyFailure,
      () => live && !replaying && !frontInactive(),
    );
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
        const selected = terminal.getSelection();
        if (selected) {
          void writeClipboard(selected)
            .then(() => {
              if (live && terminal.getSelection() === selected) terminal.clearSelection();
            })
            .catch(reportCopyFailure);
        }
        return false;
      }

      // WebViews do not consistently dispatch native paste for Ctrl+V. Read on the
      // host and let xterm normalize newlines and apply bracketed paste mode.
      if (plain && event.ctrlKey && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void readClipboard()
          .then((text) => {
            if (!live || frontInactive()) return;
            setPasteFailed(false);
            if (text !== null) terminal.paste(text);
            else return writeShell(session.id, PASTE_KEY);
          })
          .catch((error) => {
            console.error("Could not paste terminal clipboard", error);
            if (live) setPasteFailed(true);
          });
        return false;
      }

      // Ctrl+digit, Ctrl+arrow, Ctrl+A, Ctrl+Alt+A, Ctrl+Alt+arrow and Ctrl+X are the window's keys.
      // xterm stops the propagation of every key it sends, so a key the window wants must be refused here.
      const digit = event.key.length === 1 && event.key >= "0" && event.key <= "9";
      if (plain && event.ctrlKey && !event.shiftKey && digit) return false;

      if (plain && event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "x") {
        return false;
      }

      if (plain && event.ctrlKey && ARROWS.has(event.key)) return false;

      if (
        event.ctrlKey &&
        event.altKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (["a", "x"].includes(event.key.toLowerCase()) || ARROWS.has(event.key))
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

    // Output for a terminal nobody is looking at waits for an idle moment, so the one being typed
    // at is never parsing behind it.
    let unseen = "";
    let idle: number | null = null;
    const catchUp = () => {
      if (idle !== null) cancelIdleCallback(idle);
      idle = null;
      if (!unseen) return;
      terminal.write(unseen);
      unseen = "";
    };
    catchUpNow.current = catchUp;
    const draw = (data: string) => {
      if (showing.current) {
        catchUp();
        terminal.write(data);
        return;
      }
      unseen += data;
      idle ??= requestIdleCallback(catchUp, { timeout: UNSEEN_WAIT });
    };

    // Data heard before the backlog arrives is held and replayed after it.
    let reached: number | null = null;
    const waiting: Said[] = [];
    const say = (said: Said) => {
      if (reached === null) waiting.push(said);
      else if (said.seq >= reached) draw(said.data);
    };

    const incoming = listen<Said>(DATA_EVENT, (event) => {
      if (event.payload.id === session.id) say(event.payload);
    });
    const finished = listen<string>(EXIT_EVENT, (event) => {
      if (event.payload === session.id && live) ended.current();
    });

    // Written at the default size, a backlog would be pushed up as the terminal shrinks to fit.
    let stopSizing = () => {};
    const sized = new Promise<void>((resolve) => {
      if (element.clientWidth > 0 && element.clientHeight > 0) return resolve();
      const wait = new ResizeObserver(() => {
        if (element.clientWidth === 0 || element.clientHeight === 0) return;
        wait.disconnect();
        resolve();
      });
      wait.observe(element);
      stopSizing = () => wait.disconnect();
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

        await sized;
        if (!live) return;
        // An earlier resize can precede shell startup; send its actual grid after attaching.
        lastGrid = null;
        measure();
        await new Promise<void>((resolve) => terminal.write(held.text, resolve));
        if (!live) return;
        replaying = false;
        reached = held.upto;
        for (const said of waiting) say(said);
        waiting.length = 0;
        const before = frontValue<{
          scroll: number;
          below?: number;
          selection?: { start: { x: number; y: number }; end: { x: number; y: number } };
        }>(stateKey);
        if (before) {
          terminal.scrollToLine(before.scroll);
          element.scrollTop = before.below ?? 0;
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
    const screen = terminal.element?.querySelector(".xterm-screen");
    const header = element.closest(".page")?.querySelector(".page__header");
    if (screen) resize.observe(screen);
    if (header) resize.observe(header);

    return () => {
      live = false;
      if (idle !== null) cancelIdleCallback(idle);
      catchUpNow.current = null;
      drawn.current = null;
      settle.current = null;
      reclaimSize.current = null;
      resize.disconnect();
      stopSizing();
      element.removeEventListener("paste", onPaste, true);
      void incoming.then((stop) => stop());
      void finished.then((stop) => stop());
      // The shell is left running; closing the session is what ends it.
      clipboard.dispose();
      scrollSpace.dispose();
      for (const handler of queryHandlers) handler.dispose();
      terminal.dispose();
      forget();
    };
  }, [host, session.id, session.cwd, viewer]);

  // Told rather than rebuilt: a rebuilt terminal loses its scrollback.
  useEffect(() => {
    const terminal = drawn.current;
    if (terminal) terminal.options.theme = colours;
  }, [colours]);

  useEffect(() => {
    const terminal = drawn.current;
    if (!terminal) return;
    terminal.options.fontFamily = look.mono;
    terminal.options.allowTransparency = look.seeThrough;
  }, [look.mono, look.seeThrough]);

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
    compactAt.current = compact;
    settle.current?.();
  }, [compact]);
  useEffect(() => {
    textAt.current = terminalText;
    settle.current?.();
  }, [terminalText]);
  useEffect(() => {
    showing.current = shown;
    if (shown) catchUpNow.current?.();
    if (shown && host && resizeAt.current) drawn.current?.focus();
  }, [shown, host]);

  return (
    <Box
      ref={setHost}
      data-terminal={session.id}
      data-terminal-shown={shown}
      data-terminal-viewer={viewer || undefined}
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
        // The viewport covers the padding too; outrank xterm's default black regardless of load order.
        "&& .xterm-viewport": { backgroundColor: look.seeThrough ? "transparent" : opaque },
      }}
    >
      {pasteFailed && (
        <Alert
          severity="error"
          onClose={() => setPasteFailed(false)}
          sx={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}
        >
          {t("terminal.pasteFailed")}
        </Alert>
      )}
      {copyFailed && (
        <Alert
          severity="error"
          onClose={() => setCopyFailed(false)}
          sx={{ position: "absolute", top: 0, right: 0, zIndex: 1 }}
        >
          {t("terminal.copyFailed")}
        </Alert>
      )}
      <ResumeBar id={session.id} />
    </Box>
  );
}
