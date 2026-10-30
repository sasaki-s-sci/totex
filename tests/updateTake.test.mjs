import assert from "node:assert/strict";
import { after, afterEach, test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { createServer } from "vite";

// Exercise the update command with a shell that can refuse activation before loading a frame.
const dependencies = {
  "../../ephemeral/runtime":
    "export const ephemeralIdentity = () => ({ version: '' }); export const swapEphemeral = () => {};",
  "../../resume/runtime": "export const holdForRestart = () => Promise.resolve();",
  "../../shell/state": "export const carryAcrossRestart = () => Promise.resolve();",
  "../../shell/bridge":
    "export const connection = { activate: (...args) => globalThis.activateUpdate(...args) };",
};
const server = await createServer({
  configFile: false,
  server: { watch: null },
  plugins: [
    {
      name: "update-shell-fixture",
      enforce: "pre",
      resolveId(source, importer) {
        if (importer?.endsWith("/src/lib/update/take.ts") && source in dependencies)
          return `\0${source}`;
      },
      load(id) {
        return dependencies[id.slice(1)];
      },
    },
  ],
});
const { take } = await server.ssrLoadModule("/src/lib/update/take.ts");
const store = await server.ssrLoadModule("/src/lib/update/store.ts");
after(() => server.close());
afterEach(() => {
  clearMocks();
  delete globalThis.activateUpdate;
});
globalThis.window ??= {};
window.crypto ??= globalThis.crypto;

test("a late startup response cannot replace standing refreshed after activation", async () => {
  for (const fails of [false, true]) {
    const pending = [];
    mockIPC((command) => {
      assert.equal(command, "update_standing");
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    });
    const startup = store.askStanding(true);
    const refreshed = store.askStanding(true);
    const current = [{ layer: "ephemeral", at: "1.2.4" }];
    pending[1].resolve(current);
    await refreshed;
    if (fails) pending[0].reject(new Error("Startup request failed"));
    else pending[0].resolve([{ layer: "ephemeral", at: "1.2.3" }]);
    await startup;
    assert.deepEqual(store.state.rungs, current);
    assert.deepEqual(await store.askStanding(), current);
  }
});

test("a shell refusing activation rolls back the staged patch so it can be retried", async () => {
  const calls = [];
  let pending = false;
  mockIPC((command) => {
    calls.push(command);
    if (command === "update_take") {
      if (pending) throw new Error("an ephemeral update is waiting for activation");
      pending = true;
      return "taken";
    }
    if (command === "rollback_front") pending = false;
    if (command === "update_standing") return [];
  });
  globalThis.activateUpdate = async () => {
    throw new Error("Frontend is not active");
  };
  assert.equal(await take("ephemeral", "1.2.4"), "failed");
  assert.equal(pending, false);
  assert.deepEqual(calls, ["update_take", "rollback_front", "update_standing"]);

  calls.length = 0;
  globalThis.activateUpdate = async (version) => {
    assert.equal(version, "1.2.4");
    pending = false;
  };
  assert.equal(await take("ephemeral", "1.2.4"), "swapped");
  assert.deepEqual(calls, ["update_take", "update_standing"]);
});
