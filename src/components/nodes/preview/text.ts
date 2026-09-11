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
 * Puts a tab where the caret is, in place of whatever is selected.
 *
 * Through the editing command rather than the DOM, so that the press goes on
 * the same undo stack as the letters around it and raises the same `input`
 * event the card listens to. Where the engine has no such command, the range
 * is written to by hand and the event is raised by hand with it.
 */
export function insertTab(paper: HTMLElement): void {
  if (document.execCommand("insertText", false, "\t")) return;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!paper.contains(range.commonAncestorContainer)) return;
  range.deleteContents();
  const tab = document.createTextNode("\t");
  range.insertNode(tab);
  range.setStartAfter(tab);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  paper.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: "\t" }),
  );
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
