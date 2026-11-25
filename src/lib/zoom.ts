export const ZOOM_EVENT = "totex:zoom";
export type ZoomStep = -1 | 0 | 1;

export function zoomKey(event: {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
}): ZoomStep | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing) return null;
  if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") return 1;
  if (event.key === "-" || event.code === "NumpadSubtract") return -1;
  return event.key === "0" ? 0 : null;
}

export function zoomed(value: number, step: ZoomStep): number {
  return step === 0 ? 1 : Math.min(8, Math.max(0.25, value * 1.25 ** step));
}
