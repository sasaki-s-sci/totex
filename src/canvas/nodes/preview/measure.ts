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

// The rule holding the element to the card is lifted for one forced layout, then put back.
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
