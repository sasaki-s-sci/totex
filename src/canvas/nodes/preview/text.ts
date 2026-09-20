// `textContent` misses element line breaks and `innerText` forces a reflow per key.
export function draftOf(root: Node): string {
  let text = "";
  for (const node of root.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) text += node.nodeValue ?? "";
    else if (node.nodeName === "BR") text += "\n";
    else text += draftOf(node);
  }
  return text.replace(/\r\n?/g, "\n");
}

// Through the editing command so the tab joins the undo stack and raises `input`.
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

// The reverse of insertTab: found by where Selection.modify says the caret's own line
// begins, since a tab is only ever leading and the caret can be sitting anywhere past it.
export function removeTab(paper: HTMLElement): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  if (!paper.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
  if (!selection.isCollapsed) selection.collapseToStart();

  selection.modify("extend", "backward", "lineboundary");
  const column = selection.toString().length;
  selection.collapseToStart();
  selection.modify("extend", "forward", "character");

  const removed = selection.toString() === "\t" && document.execCommand("delete");
  if (!removed) selection.collapseToStart();
  const back = removed ? Math.max(0, column - 1) : column;
  for (let step = 0; step < back; step += 1) selection.modify("move", "forward", "character");
}

export function countLines(text: string): number {
  const body = text.endsWith("\n") ? text.slice(0, -1) : text;
  return body.split("\n").length;
}

// One string, not an element per line.
export function lineNumbers(count: number): string {
  const lines: string[] = [];
  for (let line = 1; line <= count; line += 1) lines.push(String(line));
  return lines.join("\n");
}
