/**
 * What a press is landing on, which is how the window tells its own keys from
 * everybody else's.
 *
 * Every shortcut the window takes it takes from whatever has the focus, and the
 * two things that can have it want opposite answers: a field being written in
 * keeps its keys, and a terminal is where the window's keys matter most. A
 * terminal is a textarea of xterm's own, so the pair below have to be asked in
 * that order — what it is drawn inside, before what element it is.
 */

/** Whether the keys are being typed into a terminal, which the window otherwise
 *  sees as a textarea like any other: the arrows are for leaving one. */
export function terminal(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(".xterm") !== null;
}

/** Whether the keys belong to something being typed into. */
export function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}
