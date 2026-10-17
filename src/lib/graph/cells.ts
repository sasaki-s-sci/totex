// Card text is measured in terminal columns, not characters: a CJK character is two cells.

export function clamp(lines: string[], most: number): string[] {
  if (lines.length <= most) return lines;
  const kept = lines.slice(0, most);
  kept[most - 1] = `${kept[most - 1].trimEnd()}…`;
  return kept;
}

/** Breaks at spaces, and through a word where there are none. */
export function wrap(text: string, width: number): string[] {
  const trimmed = text.trim();
  if (trimmed === "") return [];

  const lines: string[] = [];
  let line = "";
  let taken = 0;

  const keep = () => {
    if (line !== "") lines.push(line);
    line = "";
    taken = 0;
  };

  for (const word of trimmed.split(/\s+/)) {
    let rest = word;
    while (cellsOf(rest) > width) {
      if (taken > 0) keep();
      const [head, tail] = split(rest, width);
      lines.push(head);
      rest = tail;
    }
    const wide = cellsOf(rest);
    if (taken > 0 && taken + 1 + wide > width) keep();
    line = taken > 0 ? `${line} ${rest}` : rest;
    taken += taken > 0 ? wide + 1 : wide;
  }
  keep();

  return lines;
}

function split(word: string, width: number): [string, string] {
  let taken = 0;
  let at = 0;
  for (const letter of word) {
    const wide = cellsOf(letter);
    if (taken + wide > width) break;
    taken += wide;
    at += letter.length;
  }
  // A width under one character must still make progress through the word.
  if (at === 0) at = [...word][0]?.length ?? word.length;
  return [word.slice(0, at), word.slice(at)];
}

function cellsOf(text: string): number {
  let cells = 0;
  for (const letter of text) cells += wide(letter) ? 2 : 1;
  return cells;
}

// East Asian wide and emoji ranges: a terminal draws these two cells across.
function wide(letter: string): boolean {
  const code = letter.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xa960 && code <= 0xa97f) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe19) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1f64f) ||
    (code >= 0x1f680 && code <= 0x1f6ff) ||
    (code >= 0x1f900 && code <= 0x1f9ff) ||
    (code >= 0x20000 && code <= 0x3fffd)
  );
}
