import type { Terminal } from "@xterm/xterm";

/** Extra space belongs to the view, never to the shell's output or terminal grid. */
export function registerTerminalScroll(terminal: Terminal, host: HTMLElement) {
  const screen = host.querySelector<HTMLElement>(".xterm");
  if (!screen) throw new Error("Terminal must be open before registering scroll space");
  const sync = () => {
    const enabled = terminal.buffer.active.type === "normal";
    screen.style.marginBottom = enabled ? `${host.clientHeight / 2}px` : "0px";
    if (!enabled || terminal.buffer.active.viewportY < terminal.buffer.active.baseY)
      host.scrollTop = 0;
  };
  const wheel = (event: WheelEvent) => {
    if (event.ctrlKey || event.deltaY === 0 || terminal.modes.mouseTrackingMode !== "none") return;
    if (terminal.buffer.active.type !== "normal") return;
    const buffer = terminal.buffer.active;
    if (host.scrollTop === 0 && (event.deltaY < 0 || buffer.viewportY < buffer.baseY)) return;
    const unit =
      event.deltaMode === 1
        ? host.clientHeight / terminal.rows
        : event.deltaMode === 2
          ? host.clientHeight
          : 1;
    host.scrollTop = Math.max(
      0,
      Math.min(
        host.clientHeight / 2,
        host.scrollTop + event.deltaY * unit * (terminal.options.scrollSensitivity ?? 1),
      ),
    );
    event.preventDefault();
    event.stopPropagation();
  };
  host.addEventListener("wheel", wheel, { capture: true, passive: false });
  const resized = new ResizeObserver(sync);
  resized.observe(host);
  const parsed = terminal.onWriteParsed(sync);
  const scrolled = terminal.onScroll(sync);
  sync();
  return {
    dispose() {
      resized.disconnect();
      parsed.dispose();
      scrolled.dispose();
      host.removeEventListener("wheel", wheel, true);
      screen.style.marginBottom = "";
      host.scrollTop = 0;
    },
  };
}
