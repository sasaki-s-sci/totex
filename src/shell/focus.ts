import { frontValue, keepFrontValue } from "./state";

type Focus = { selector: string; start?: number | null; end?: number | null };
export function captureFocus(): void {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || element === document.body) return;
  const terminal = element.closest<HTMLElement>("[data-terminal]");
  const card = element.closest<HTMLElement>(".react-flow__node[data-id]");
  const scope = terminal
    ? `[data-terminal="${CSS.escape(terminal.dataset.terminal ?? "")}"] `
    : card
      ? `[data-id="${CSS.escape(card.dataset.id ?? "")}"] `
      : "";
  const selector =
    scope +
    (element.id
      ? `#${CSS.escape(element.id)}`
      : element.getAttribute("aria-label")
        ? `[aria-label="${CSS.escape(element.getAttribute("aria-label") ?? "")}"]`
        : element.tagName.toLowerCase());
  const focus: Focus = { selector };
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    focus.start = element.selectionStart;
    focus.end = element.selectionEnd;
  } else if (element.isContentEditable) {
    const selection = window.getSelection();
    if (
      selection?.rangeCount &&
      element.contains(selection.anchorNode) &&
      element.contains(selection.focusNode)
    ) {
      const range = selection.getRangeAt(0);
      const before = document.createRange();
      before.selectNodeContents(element);
      before.setEnd(range.startContainer, range.startOffset);
      focus.start = before.toString().length;
      focus.end = focus.start + range.toString().length;
    }
  }
  keepFrontValue("focus", focus);
}

export function restoreFocus(): void {
  window.focus();
  const before = frontValue<Focus>("focus");
  const element = before ? document.querySelector<HTMLElement>(before.selector) : null;
  if (!element) {
    document
      .querySelector<HTMLElement>('[data-terminal-shown="true"] .xterm-helper-textarea')
      ?.focus();
    return;
  }
  element.focus({ preventScroll: true });
  if (before?.start == null || before.end == null) return;
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    try {
      element.setSelectionRange(before.start, before.end);
    } catch {
      /* Some input types have no selection. */
    }
  } else if (element.isContentEditable) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const range = document.createRange();
    let offset = 0;
    let started = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const end = offset + (node.textContent?.length ?? 0);
      if (!started && before.start <= end) {
        range.setStart(node, Math.max(0, before.start - offset));
        started = true;
      }
      if (started && before.end <= end) {
        range.setEnd(node, Math.max(0, before.end - offset));
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        return;
      }
      offset = end;
    }
  }
}
