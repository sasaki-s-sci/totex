import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { OPEN_FILE, openFile } from "../src/lib/openFile.ts";
import { terminalTarget, terminalTextAt } from "../src/lib/terminalTargets.ts";

const origin = "http://localhost:1420";
const target = (text, cwd = "/home/a/repo") => terminalTarget(text, cwd, origin);
const file = (value) => ({ kind: "file", value });

test("terminal URLs use the same origin and credential restrictions as internal pages", () => {
  assert.deepEqual(target("https://EXAMPLE.com/a?q=1#part"), {
    kind: "url",
    value: "https://example.com/a?q=1#part",
  });
  for (const value of [
    "javascript:alert(1)",
    "https://user:password@example.com/a",
    `${origin}/front.html`,
    "http://tauri.localhost/",
    "https://ipc.localhost/",
    "mailto:user@example.com",
    "data:text/html,hello",
    "http://",
    "ordinary output",
    "../file\ncommand",
    "../file\x1bcommand",
    "file:///tmp/a%0ab",
  ])
    assert.equal(target(value), null, value);
});

test("terminal file paths resolve relative to the shell's machine and preserve literal characters", () => {
  for (const [text, cwd, expected] of [
    ["src/main.test.ts:12:4", "/home/a/repo", "/home/a/repo/src/main.test.ts"],
    ["../note.txt:2", "/home/a/repo", "/home/a/note.txt"],
    [".gitignore", "/home/a/repo", "/home/a/repo/.gitignore"],
    ['"my note.txt"', "/tmp", "/tmp/my note.txt"],
    ["./a%20b#c?d.txt", "/tmp", "/tmp/a%20b#c?d.txt"],
    ["./a%0ab.txt", "/tmp", "/tmp/a%0ab.txt"],
    ["~/note.txt", "/tmp", "~/note.txt"],
    ["../a.ts:10:2", "C:\\Users\\a\\repo", "C:\\Users\\a\\a.ts"],
    ["D:\\src\\a.ts:12", "C:\\repo", "D:\\src\\a.ts"],
    ["/tmp/a.txt", "\\\\wsl.localhost\\Ubuntu\\home\\a", "\\\\wsl.localhost\\Ubuntu\\tmp\\a.txt"],
    ["~/../a.txt", "\\\\wsl$\\Ubuntu\\home\\a", "\\\\wsl$\\Ubuntu\\~/../a.txt"],
    ["../a.txt", "ssh://user@box:22/home/a/repo", "ssh://user@box:22/home/a/a.txt"],
    ["/tmp/a.txt", "ssh://box/home/a", "ssh://box/tmp/a.txt"],
    ["~/../a.txt", "ssh://box/home/a", "ssh://box/~/../a.txt"],
    ["ssh://other/tmp/../a.txt", "/tmp", "ssh://other/a.txt"],
    ["file:///tmp/my%20note.txt#L10", "/tmp", "/tmp/my note.txt"],
    ["file:///C:/repo/a.ts", "C:\\repo", "C:\\repo\\a.ts"],
    ["file://server/share/a.txt", "C:\\repo", "\\\\server\\share\\a.txt"],
    ["file://box/tmp/a.txt", "ssh://box/home/a", "ssh://box/tmp/a.txt"],
  ])
    assert.deepEqual(target(text, cwd), file(expected), text);
});

function line(text, wrapped = false) {
  const cells = [];
  for (const char of text) {
    cells.push({ chars: char, width: char === "猫" ? 2 : 1 });
    if (char === "猫") cells.push({ chars: "", width: 0 });
  }
  while (cells.length < 10) cells.push({ chars: "", width: 1 });
  return {
    length: cells.length,
    isWrapped: wrapped,
    getCell(column) {
      const cell = cells[column];
      return cell && { getChars: () => cell.chars, getWidth: () => cell.width };
    },
    translateToString(_trim, start = 0, end = cells.length) {
      return cells
        .slice(start, end)
        .map(({ chars, width }) => chars || (width ? " " : ""))
        .join("");
    },
  };
}

function terminal(lines) {
  return {
    cols: 10,
    rows: 3,
    buffer: { active: { viewportY: 1, length: lines.length, getLine: (row) => lines[row] } },
    element: {
      querySelector: () => ({
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 100,
          bottom: 60,
          width: 100,
          height: 60,
        }),
      }),
    },
  };
}

test("right-click text follows wrapped buffer lines, scrollback and wide-character cells", () => {
  const view = terminal([
    line("history"),
    line("猫 ./long/"),
    line("path.txt e", true),
    line("nd", true),
  ]);
  assert.equal(terminalTextAt(view, 25, 30), "./long/path.txt");
  assert.equal(terminalTextAt(view, 15, 10), "猫");
  assert.equal(terminalTextAt(view, 110, 10), null);
  const quoted = terminal([line("history"), line('"./my file'), line(' name.txt"', true)]);
  assert.equal(terminalTextAt(quoted, 25, 30), '"./my file name.txt"');
});

afterEach(() => {
  delete globalThis.window;
});
test("file requests retain session identity and reject control bytes or unhandled requests", () => {
  globalThis.window = new EventTarget();
  assert.equal(openFile("/tmp/note.txt", "terminal-one"), false);
  const opened = [];
  window.addEventListener(OPEN_FILE, (event) => {
    opened.push(event.detail);
    event.preventDefault();
  });
  assert.equal(openFile("/tmp/note.txt", "terminal-one"), true);
  assert.equal(openFile("/tmp/note\n.txt", "terminal-one"), false);
  assert.equal(openFile("/tmp/note.txt", ""), false);
  assert.deepEqual(opened, [{ path: "/tmp/note.txt", sessionId: "terminal-one" }]);
});
