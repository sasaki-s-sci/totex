/**
 * Reading the card's own text back out of it, and the two numbers set beside it.
 */

/**
 * What an editable box holds, as text.
 *
 * `textContent` alone would not answer for it: a line break in an editable box
 * can be put there as an element rather than as a newline. `innerText` answers
 * for both, but it is laid out to answer, and that is a reflow for every key
 * pressed. Walking what is there costs neither.
 */
export function draftOf(root: Node): string {
  let text = "";
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? "";
    else if (node.nodeName === "BR") text += "\n";
    else text += draftOf(node);
  }
  return text.replace(/\r\n?/g, "\n");
}

/**
 * How many lines a reading has.
 *
 * A reading that ends in a newline ends there. The empty line after it is still
 * drawn — the text is shown as it is — but it is not counted, which is what an
 * editor makes of the same file.
 */
export function countLines(text: string): number {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n").length;
}

/**
 * The numbers down the side of a reading, as one string.
 *
 * One string and not one element per line: sixty-four kilobytes is a few
 * thousand lines, and a gutter built out of elements puts a few thousand more
 * on a canvas whose frame is counted in elements rather than in arithmetic.
 */
export function lineNumbers(count: number): string {
  const lines: string[] = [];
  for (let line = 1; line <= count; line += 1) lines.push(String(line));
  return lines.join("\n");
}

export function formatSize(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(bytes < 10_000 ? 1 : 0)} KB`;
  if (bytes < 1_000_000_000) {
    return `${(bytes / 1_000_000).toFixed(bytes < 10_000_000 ? 1 : 0)} MB`;
  }
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
