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
