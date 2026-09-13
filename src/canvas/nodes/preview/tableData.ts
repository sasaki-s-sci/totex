export const TABLE_MAX_ROWS = 10001;
export const TABLE_MAX_COLUMNS = 100;
const MAX_CELL_LENGTH = 20000;

export function parseTable(text: string, delimiter: "," | "\t") {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closed = false;
  let limited = false;
  let malformed = false;
  let column = 0;
  let started = false;
  const input = text.replace(/^\uFEFF/, "");

  function append(value: string) {
    started = true;
    if (column >= TABLE_MAX_COLUMNS || cell.length >= MAX_CELL_LENGTH) limited = true;
    else cell += value;
  }
  function field() {
    if (column < TABLE_MAX_COLUMNS) row.push(cell);
    else limited = true;
    column++;
    cell = "";
    closed = false;
    started = false;
  }
  function record() {
    field();
    rows.push(row);
    row = [];
    column = 0;
  }

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          append('"');
          index++;
        } else {
          quoted = false;
          closed = true;
        }
      } else append(char);
    } else if (char === delimiter) {
      field();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      record();
      if (rows.length >= TABLE_MAX_ROWS && index + 1 < input.length) {
        limited = true;
        break;
      }
    } else if (char === '"' && !started && !closed) {
      quoted = true;
      started = true;
    } else {
      if (closed || char === '"') malformed = true;
      append(char);
    }
  }
  if (quoted) malformed = true;
  if (rows.length < TABLE_MAX_ROWS && (cell.length > 0 || column > 0 || closed || quoted)) record();
  return { rows, limited, malformed };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const numberPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

export function compareTableCells(left: string, right: string, direction: "asc" | "desc") {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  const aNumeric = numberPattern.test(a) && Number.isFinite(Number(a));
  const bNumeric = numberPattern.test(b) && Number.isFinite(Number(b));
  // Keep numeric and text categories consistent across mixed-column comparisons.
  const delta =
    aNumeric !== bNumeric
      ? aNumeric
        ? -1
        : 1
      : aNumeric
        ? Number(a) - Number(b)
        : collator.compare(a, b);
  return direction === "asc" ? delta : -delta;
}
