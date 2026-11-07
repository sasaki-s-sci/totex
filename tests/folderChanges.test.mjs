import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createServer } from "vite";

const server = await createServer({ configFile: false, server: { watch: null, ws: false } });
const { watchChanges, refreshChanges, changesIn } =
  await server.ssrLoadModule("/src/folder/changes.ts");
after(() => server.close());
afterEach(() => clearMocks());
globalThis.window = new EventTarget();
const settled = () => new Promise(setImmediate);

test("changes and newly opened folders during a read get another reading", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const first = Promise.withResolvers();
  const calls = [];
  const clean = { changed: {}, ignored: [], allIgnored: false };
  const ignored = { ...clean, ignored: ["run.log"] };
  mockIPC((command, { paths }) => {
    assert.equal(command, "directory_changes");
    calls.push(paths);
    return calls.length === 1 ? first.promise : { "/repo": clean, "/repo/logs": ignored };
  });
  t.after(watchChanges("/repo", () => {}));
  t.mock.timers.tick(200);
  await settled();
  assert.equal(calls.length, 1);

  refreshChanges();
  t.after(watchChanges("/repo/logs", () => {}));
  t.mock.timers.tick(200);
  await settled();
  assert.equal(calls.length, 1, "Reads must not overlap");

  first.resolve({ "/repo": { ...clean, changed: { logs: "added" } } });
  await settled();
  assert.equal(calls.length, 2, "Refresh must not wait for the six-second polling interval");
  assert.deepEqual(calls[1], ["/repo", "/repo/logs"]);
  assert.deepEqual(changesIn("/repo"), clean);
  assert.deepEqual(changesIn("/repo/logs"), ignored);
});
