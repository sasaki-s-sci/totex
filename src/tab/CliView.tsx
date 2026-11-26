import { Alert, Box, Button, Menu, MenuItem } from "@mui/material";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { FitAddon } from "@xterm/addon-fit";
import { ImageAddon } from "@xterm/addon-image";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal } from "@xterm/xterm";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppSettings } from "../lib/appSettings";
import { clipboardFiles, copyText, pasteMedia, readClipboard } from "../lib/clipboard";
import { openFile } from "../lib/openFile";
import { openPage } from "../lib/openPage";
import {
  attachShell,
  DATA_EVENT,
  EXIT_EVENT,
  type Held,
  resizeShell,
  type Said,
  startShell,
  writeShell,
} from "../lib/pty";
import type { Session } from "../lib/session";
import { registerTerminalClipboard } from "../lib/terminalClipboard";
import { registerTerminalDrop, terminalPaths } from "../lib/terminalDrop";
import { openTerminalLink } from "../lib/terminalLinks";
import { registerTerminalPages } from "../lib/terminalPages";
import { registerTerminalScroll } from "../lib/terminalScroll";
import { type TerminalTarget, terminalTarget, terminalTextAt } from "../lib/terminalTargets";
import { useWheel, wheelFactor } from "../lib/wheel";
import { zoomed, zoomKey } from "../lib/zoom";
import { ResumeBar } from "../resume/ResumeBar";
import { frontInactive, readyAfter } from "../shell/bridge";
import { frontValue, readOnSnapshot } from "../shell/state";
import { usePalette, useTerminalLook, withAlpha } from "../theme";

import "@xterm/xterm/css/xterm.css";

// Meta Return: what Alt+Return sends, read by agents as a line break.
const ANOTHER_LINE = "\x1b\r";

const ARROWS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

const FONT = 12;
// On the emulator's own element, where fit subtracts it; the scrollbar supplies the right inset.
const PAD = { x: 8, y: 4 };
// Reserved beside the text as the overview ruler's width, which is what the fit addon takes
// off whether or not a bar is drawn; the slider is dressed inside it by canvas/styles/terminal.css.
const SCROLLBAR = 7;
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
  const [openFailed, setOpenFailed] = useState(false);
  const [menu, setMenu] = useState<{
    top: number;
    left: number;
    target: TerminalTarget;
  } | null>(null);
  const [pasteFailed, setPasteFailed] = useState(false);
  const [failed, setFailed] = useState(false);
  const [connectionAttempt, retryConnection] = useState(0);
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
  const [zoom, setZoom] = useState(1);
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
    setOpenFailed(false);
    setMenu(null);
    setPasteFailed(false);
    const activateLink = (event: MouseEvent, uri: string) =>
      openTerminalLink(event, uri, session.id);
    let hoveredLink: string | null = null;
    const linkHover = {
      hover: (_event: MouseEvent, uri: string) => {
        hoveredLink = uri;
      },
      leave: () => {
        hoveredLink = null;
      },
    };

    // Keep the DOM renderer: swapping renderers on visibility changes also changes the PTY grid.
    const terminal = new Terminal({
      fontSize: (FONT * drawnAt.current * textAt.current) / 100,
      fontFamily: look.mono,
      allowTransparency: look.seeThrough,
      cursorBlink: true,
      theme: colours,
      scrollSensitivity: wheelFactor("cli"),
      overviewRuler: { width: SCROLLBAR },
      linkHandler: { activate: activateLink, ...linkHover, allowNonHttpProtocols: true },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon(activateLink, linkHover));
    // Sixel and iTerm2 inline images; storage held small because there are several terminals.
    terminal.loadAddon(new ImageAddon({ storageLimit: 32 }));
    terminal.open(element);
    const scrollSpace = registerTerminalScroll(terminal, element);
    let pages: ReturnType<typeof registerTerminalPages> | undefined;
    const composition = element.querySelector<HTMLElement>(".composition-view");
    const compositionScreen = element.querySelector<HTMLElement>(".xterm-screen");
    const compositionHelpers = composition?.parentElement;
    const placeComposition = () => {
      if (!composition?.classList.contains("active") || !compositionScreen || !compositionHelpers)
        return;
      // xterm replaces this text on each update; only the text should cover existing terminal cells.
      if (!composition.firstElementChild) {
        const text = document.createElement("span");
        text.textContent = composition.textContent;
        composition.replaceChildren(text);
      }
      const style = compositionHelpers.style;
      style.setProperty("--composition-width", compositionScreen.style.width);
      style.setProperty("--composition-height", compositionScreen.style.height);
      style.setProperty("--composition-indent", composition.style.left);
      style.setProperty("--composition-line", composition.style.lineHeight);
      style.setProperty(
        "--composition-room",
        `${parseFloat(compositionScreen.style.height) - parseFloat(composition.style.top)}px`,
      );
      composition.scrollTop = composition.scrollHeight;
    };
    element.addEventListener("compositionupdate", placeComposition);
    const compositionRendered = terminal.onRender(placeComposition);
    drawn.current = terminal;
    const contextMenu = (event: MouseEvent) => {
      const selected = terminalTarget(terminal.getSelection(), session.cwd, location.origin);
      const text = hoveredLink ?? terminalTextAt(terminal, event.clientX, event.clientY);
      const target = hoveredLink
        ? terminalTarget(hoveredLink, session.cwd, location.origin)
        : (selected ?? terminalTarget(text ?? "", session.cwd, location.origin));
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      setMenu({ top: event.clientY, left: event.clientX, target });
    };
    element.addEventListener("contextmenu", contextMenu, true);
    const stateKey = `terminal.${viewer ? "viewer." : ""}${session.id}`;
    const forget = readOnSnapshot(stateKey, () => ({
      scroll: terminal.buffer.active.viewportY,
      below: element.scrollTop,
      selection: terminal.getSelectionPosition(),
    }));

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

    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    settle.current = () => {
      clearTimeout(resizeTimer);
      // Let a drag settle and queued output finish before changing both grids.
      resizeTimer = setTimeout(() => {
        terminal.write("", () => {
          if (live && element.clientWidth > 0 && element.clientHeight > 0) measure();
        });
      }, 100);
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

    const pastePaths = async (paths: readonly string[]) => {
      if (!paths.length) return;
      const text = await terminalPaths(paths, session.cwd);
      if (!live || frontInactive()) return;
      terminal.paste(text);
      terminal.focus();
      setPasteFailed(false);
    };
    const pasteFailure = (error: unknown) => {
      console.error("Could not paste terminal content", error);
      if (live) setPasteFailed(true);
    };
    const stopDrop = registerTerminalDrop(
      element,
      (paths) => void pastePaths(paths).catch(pasteFailure),
    );

    // Media becomes a file on the terminal's host; text keeps xterm's normal paste handling.
    const onPaste = (event: ClipboardEvent) => {
      const carried = event.clipboardData;
      if (!carried) return;
      const file =
        carried.types.includes("Files") ||
        Array.from(carried.items).some((item) => item.kind === "file");
      if (!file) return;
      event.preventDefault();
      event.stopPropagation();
      void pasteMedia(undefined, carried).then(pastePaths).catch(pasteFailure);
    };
    element.addEventListener("paste", onPaste, true);

    terminal.attachCustomKeyEventHandler((event) => {
      const zoomStep = zoomKey(event);
      if (zoomStep !== null) {
        event.preventDefault();
        if (event.type === "keydown") setZoom((before) => zoomed(before, zoomStep));
        return false;
      }
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
      if (!event.altKey && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v") {
        event.preventDefault();
        void (async () => {
          const files = await clipboardFiles().catch(() => []);
          if (files?.length) return pastePaths(files);
          let text: string | null;
          try {
            text = await readClipboard();
          } catch (error) {
            const media = await pasteMedia();
            if (!media.length) throw error;
            return pastePaths(media);
          }
          if (!live || frontInactive()) return;
          setPasteFailed(false);
          if (text !== null) terminal.paste(text);
          else await pastePaths(await pasteMedia());
        })().catch(pasteFailure);
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

        let held: Held | null;
        try {
          await startShell(session);
          if (!live) return;
          held = await attachShell(session.id);
        } catch {
          if (live) setFailed(true);
          return;
        }
        if (!live) return;
        if (!held) {
          ended.current();
          return;
        }

        // ConPTY owns viewport row growth; set its reflow rules before replaying output.
        terminal.options.windowsPty = held.windowsPty ?? {};
        await sized;
        if (!live) return;
        // An earlier resize can precede shell startup; send its actual grid after attaching.
        lastGrid = null;
        measure();
        // ConPTY's initial cursor query is still waiting for an answer, even in the backlog.
        replaying = held.upto !== 4 || held.text !== "\x1b[6n";
        await new Promise<void>((resolve) => terminal.write(held.text, resolve));
        if (!live) return;
        pages = viewer ? undefined : registerTerminalPages(terminal, session);
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
      clearTimeout(resizeTimer);
      if (idle !== null) cancelIdleCallback(idle);
      catchUpNow.current = null;
      drawn.current = null;
      settle.current = null;
      reclaimSize.current = null;
      resize.disconnect();
      stopSizing();
      element.removeEventListener("paste", onPaste, true);
      element.removeEventListener("contextmenu", contextMenu, true);
      element.removeEventListener("compositionupdate", placeComposition);
      compositionRendered.dispose();
      stopDrop();
      void incoming.then((stop) => stop());
      void finished.then((stop) => stop());
      // The shell is left running; closing the session is what ends it.
      clipboard.dispose();
      scrollSpace.dispose();
      pages?.dispose();
      for (const handler of queryHandlers) handler.dispose();
      terminal.dispose();
      forget();
    };
  }, [host, session.id, session.cwd, viewer, connectionAttempt]);

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
    textAt.current = terminalText * zoom;
    settle.current?.();
  }, [terminalText, zoom]);
  useEffect(() => {
    showing.current = shown;
    if (!shown) {
      setMenu(null);
      return;
    }
    catchUpNow.current?.();
    const frame = requestAnimationFrame(() => {
      const terminal = drawn.current;
      terminal?.refresh(0, terminal.rows - 1);
    });
    if (
      host &&
      resizeAt.current &&
      !frontInactive() &&
      !document.activeElement?.closest(".session-canvas:not([hidden])")
    )
      drawn.current?.focus();
    return () => cancelAnimationFrame(frame);
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
        "& > .xterm": {
          padding: `${PAD.y}px 0 ${PAD.y}px ${PAD.x}px`,
          // Long IME composition must not scroll the terminal sideways to reveal its hidden input.
          overflowX: "clip",
        },
        "&& .composition-view": {
          // Keep the cursor offset on the first line; later lines use the full terminal width.
          backgroundColor: "transparent",
          color: palette.text.primary,
          "& > span": { backgroundColor: opaque },
          left: "0 !important",
          width: "var(--composition-width)",
          height: "auto !important",
          maxHeight: "var(--composition-height)",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          textIndent: "var(--composition-indent)",
          overflowY: "auto",
          transform: "translateY(min(0px, calc(var(--composition-room) - 100%)))",
        },
        "& .xterm-helpers:has(.composition-view.active) .xterm-helper-textarea": {
          // xterm copies the preview's bounds; keep its invisible IME anchor inside the cursor row.
          maxWidth: "max(1px, calc(var(--composition-width) - var(--composition-indent)))",
          height: "var(--composition-line) !important",
          lineHeight: "var(--composition-line) !important",
        },
        // The viewport covers the padding too; outrank xterm's default black regardless of load order.
        "&& .xterm-viewport": { backgroundColor: look.seeThrough ? "transparent" : opaque },
      }}
    >
      {failed && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => retryConnection((at) => at + 1)}>
              {t("terminal.retry")}
            </Button>
          }
          sx={{ position: "absolute", top: 0, right: 0, zIndex: 10 }}
        >
          {t("terminal.connectFailed")}
        </Alert>
      )}
      {pasteFailed && (
        <Alert
          severity="error"
          onClose={() => setPasteFailed(false)}
          sx={{ position: "absolute", top: 0, right: 0, zIndex: 10 }}
        >
          {t("terminal.pasteFailed")}
        </Alert>
      )}
      {copyFailed && (
        <Alert
          severity="error"
          onClose={() => setCopyFailed(false)}
          sx={{ position: "absolute", top: 0, right: 0, zIndex: 10 }}
        >
          {t("terminal.copyFailed")}
        </Alert>
      )}
      {openFailed && (
        <Alert
          severity="error"
          onClose={() => setOpenFailed(false)}
          sx={{ position: "absolute", top: 0, right: 0, zIndex: 10 }}
        >
          {t("terminal.openFailed")}
        </Alert>
      )}
      <Menu
        open={menu !== null}
        onClose={() => setMenu(null)}
        container={() => host?.closest("dialog[open]") ?? document.body}
        anchorReference="anchorPosition"
        anchorPosition={menu ?? undefined}
      >
        <MenuItem
          onClick={() => {
            if (!menu) return;
            const { target } = menu;
            setMenu(null);
            setOpenFailed(
              !(target.kind === "url"
                ? openPage(target.value, session.id)
                : openFile(target.value, session.id)),
            );
          }}
        >
          {t(menu?.target.kind === "url" ? "terminal.openUrl" : "terminal.openFile")}
        </MenuItem>
        {menu?.target.kind === "url" && (
          <MenuItem
            onClick={() => {
              setMenu(null);
              setOpenFailed(false);
              void openUrl(menu.target.value).catch(() => setOpenFailed(true));
            }}
          >
            {t("terminal.openUrlInBrowser")}
          </MenuItem>
        )}
        <MenuItem
          onClick={() => {
            if (!menu) return;
            const { value } = menu.target;
            setMenu(null);
            void copyText(value)
              .then(() => setCopyFailed(false))
              .catch(() => setCopyFailed(true));
          }}
        >
          {t(menu?.target.kind === "url" ? "terminal.copyUrl" : "file.copyPath")}
        </MenuItem>
      </Menu>
      <ResumeBar id={session.id} />
    </Box>
  );
}
