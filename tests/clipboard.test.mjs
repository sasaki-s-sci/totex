import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { runInNewContext } from "node:vm";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { copyText, pasteMedia, readClipboard } from "../src/lib/clipboard.ts";

globalThis.window ??= {};
afterEach(() => clearMocks());

test("copy writes Unicode to the native host clipboard", async () => {
  const calls = [];
  mockIPC((command, args) => calls.push({ command, args }));
  await copyText("日本語 👋\nsecond line");
  assert.deepEqual(calls, [
    {
      command: "plugin:clipboard-manager|write_text",
      args: { text: "日本語 👋\nsecond line", label: undefined },
    },
  ]);
});

test("native copy failures reach the caller", async () => {
  mockIPC(() => {
    throw new Error("clipboard unavailable");
  });
  await assert.rejects(copyText("example"), /clipboard unavailable/);
});

test("paste reads host text, including empty text, without reading images", async () => {
  for (const text of ["日本語 👋\nsecond line", ""]) {
    mockIPC((command) => {
      assert.equal(command, "plugin:clipboard-manager|read_text");
      return text;
    });
    assert.equal(await readClipboard(), text);
  }
});

test("image-only paste releases the native image resource", async () => {
  const calls = [];
  mockIPC((command, args) => {
    calls.push({ command, args });
    if (command === "plugin:clipboard-manager|read_text") throw new Error("No text");
    if (command === "plugin:clipboard-manager|read_image") return 42;
  });
  assert.equal(await readClipboard(), null);
  assert.deepEqual(calls.at(-1), { command: "plugin:resources|close", args: { rid: 42 } });
});

test("unreadable clipboard reports failure rather than sending Ctrl+V", async () => {
  mockIPC(() => {
    throw new Error("clipboard unavailable");
  });
  await assert.rejects(readClipboard(), /clipboard unavailable/);
});

test("image and recording blobs stay binary in the parent window and preserve the selected folder", async () => {
  const isBinary = runInNewContext(
    "(body) => body instanceof ArrayBuffer || ArrayBuffer.isView(body) || Array.isArray(body)",
  );
  for (const type of ["image/png", "video/mp4"]) {
    mockIPC((command, bytes) => {
      assert.equal(command, "paste_media");
      assert.equal(isBinary(bytes), true, "The parent shell must recognize a raw binary body");
      assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3]);
      return "/選択/pasted-file";
    });
    assert.deepEqual(
      await pasteMedia("/選択", { files: [new Blob([new Uint8Array([1, 2, 3])], { type })] }),
      ["/選択/pasted-file"],
    );
  }
});

test("clipboard file lists copy media into the selected folder and leave unrelated files out", async () => {
  mockIPC((command, args) => {
    if (command === "clipboard_files") return ["/tmp/movie.mp4", "/tmp/program.exe"];
    assert.equal(command, "fs_copy_into");
    assert.deepEqual(args, { paths: ["/tmp/movie.mp4"], into: "/selected" });
    return ["/selected/movie.mp4"];
  });
  assert.deepEqual(await pasteMedia("/selected"), ["/selected/movie.mp4"]);
});

test("failed media writes report the error without pretending a file was saved", async () => {
  mockIPC(() => {
    throw new Error("disk full");
  });
  await assert.rejects(
    pasteMedia("/selected", { files: [new Blob(["png"], { type: "image/png" })] }),
    /disk full/,
  );
});
