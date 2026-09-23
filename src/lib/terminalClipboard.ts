import type { IDisposable, Terminal } from "@xterm/xterm";

// Bound decoding work even though xterm also limits the overall OSC payload.
const MAX_BASE64_LENGTH = 1024 * 1024;

function decodeClipboard(payload: string): string {
  if (payload.length > MAX_BASE64_LENGTH)
    throw new Error("Terminal clipboard payload is too large");
  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(payload) ||
    payload.length % 4 === 1 ||
    (payload.includes("=") && payload.length % 4 !== 0)
  ) {
    throw new Error("Invalid terminal clipboard base64");
  }
  const binary = atob(payload);
  if (btoa(binary).replace(/=+$/, "") !== payload.replace(/=+$/, "")) {
    throw new Error("Invalid terminal clipboard base64");
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    Uint8Array.from(binary, (character) => character.charCodeAt(0)),
  );
}

/** Accept OSC 52 clipboard writes without exposing clipboard reads to a shell. */
export function registerTerminalClipboard(
  terminal: Pick<Terminal, "parser">,
  copy: (text: string) => Promise<void>,
  onError: (error: unknown) => void,
  isActive: () => boolean,
): IDisposable {
  return terminal.parser.registerOscHandler(52, (data) => {
    if (!isActive()) return true;
    const separator = data.indexOf(";");
    if (separator < 0) return true;
    const selection = data.slice(0, separator);
    const payload = data.slice(separator + 1);
    if ((selection !== "" && selection !== "c") || payload === "?") return true;
    try {
      const text = decodeClipboard(payload);
      // Never stall terminal output while the desktop clipboard is being updated.
      void copy(text).catch(onError);
    } catch (error) {
      onError(error);
    }
    return true;
  });
}
