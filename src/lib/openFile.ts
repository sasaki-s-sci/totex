export const OPEN_FILE = "totex:open-file";
export type FileRequest = { path: string; sessionId: string };

export function openFile(path: string, sessionId: string): boolean {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal output must not carry control bytes into a path
  if (!path.trim() || !sessionId || /[\x00-\x1f\x7f]/.test(path)) return false;
  const request = new CustomEvent<FileRequest>(OPEN_FILE, {
    detail: { path, sessionId },
    cancelable: true,
  });
  window.dispatchEvent(request);
  return request.defaultPrevented;
}
