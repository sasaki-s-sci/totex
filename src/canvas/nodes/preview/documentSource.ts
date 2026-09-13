/** Whole-file previews arrive through the same bounded IPC read as images. */
export function sourceBytes(source: string): Uint8Array<ArrayBuffer> {
  const encoded = source.slice(source.indexOf(",") + 1);
  return Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
}
