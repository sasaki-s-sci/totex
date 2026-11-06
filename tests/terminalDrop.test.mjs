import assert from "node:assert/strict";
import { test } from "node:test";
import { quotePaths } from "../src/lib/terminalDrop.ts";

test("terminal file paths remain arguments, including spaces, quotes and shell syntax", () => {
  assert.equal(quotePaths(["/tmp/one", "/tmp/two words"], false), "/tmp/one '/tmp/two words'");
  assert.equal(quotePaths(["/tmp/a'b$(touch bad)"], false), "'/tmp/a'\\''b$(touch bad)'");
  assert.equal(quotePaths(["C:\\a'b $name.png"], true), "'C:\\a''b $name.png'");
  for (const path of ["", "/tmp/a\ncommand", "/tmp/a\r", "/tmp/a\x1b[2J"])
    assert.throws(() => quotePaths([path], false), /invalid-path/);
});
