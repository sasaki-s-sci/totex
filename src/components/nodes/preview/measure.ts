/**
 * Measuring what a card holds: how far its reading can be moved, and how wide
 * the whole of it would be.
 */

/**
 * One rail: as long a share of the edge as is being shown, as far along it as
 * the reading has been moved. Nothing to move means nothing to say.
 */
export function rail(
  element: HTMLElement | null,
  length: "width" | "height",
  from: "left" | "top",
  box: number,
  whole: number,
  at: number,
  room: number,
) {
  if (!element) return;
  if (room <= 0) {
    element.style[length] = "0px";
    return;
  }
  const size = Math.max(12, (box / whole) * box);
  element.style[length] = `${size}px`;
  element.style[from] = `${(at / room) * (box - size)}px`;
}

/**
 * How wide an element would stand if the rule holding it to the card were
 * lifted.
 *
 * Both of the things a card is as wide as are held to the card rather than to
 * themselves: the reading by a `min-width` that keeps it filling the box under
 * it, the header by being one row of a column. Neither will say what it would
 * take on its own while that holds, so the rule is taken off, the width is
 * read, and it is put straight back — one forced layout inside one press, and
 * the frame is painted from what was already there.
 */
export function widthWithout(
  element: HTMLElement | null,
  rule: "minWidth" | "width",
  lifted: string,
) {
  if (!element) return 0;
  const held = element.style[rule];
  element.style[rule] = lifted;
  const width = element.offsetWidth;
  element.style[rule] = held;
  return width;
}
