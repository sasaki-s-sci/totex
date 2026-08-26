/**
 * What a press is landing on, which is how the window tells its own keys from
 * everybody else's.
 *
 * Every shortcut the window takes it takes from whatever has the focus, and the
 * two things that can have it want opposite answers: a field being written in
 * keeps its keys, and a terminal is where the window's keys matter most. A
 * terminal is a textarea of xterm's own, so the first two below have to be asked
 * in that order — what it is drawn inside, before what element it is.
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

/**
 * Whether the keys are landing on a file card: the card itself, its header, or
 * the reading inside it.
 *
 * A file that can be typed into holds the focus in the reading, the way any
 * other written-in field does. One that cannot holds nothing that would take
 * it, so the card is given a stop of its own and keeps the focus there — a card
 * being read is as much the thing in hand as one being written in.
 *
 * A card standing on the canvas is wrapped in a node of React Flow's, which is
 * focusable as well and is what the focus lands on when the card is reached by
 * tabbing rather than by clicking. So the wrapper is read as the card it holds.
 */
export function reading(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    target.closest(".file-preview, .react-flow__node-file-preview") !== null
  );
}
