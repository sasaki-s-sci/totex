/** Asked before `typing`: a terminal is xterm's own textarea. */
export function terminal(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(".xterm") !== null;
}

export function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}

export function reading(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(".file-preview") !== null;
}
