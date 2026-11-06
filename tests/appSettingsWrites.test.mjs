import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { DEFAULT_SETTINGS } from "../src/lib/appSettingsModel.ts";

globalThis.window ??= {};
afterEach(() => clearMocks());
let serial = 0;
const document = (value) => ({ path: "/settings.json", text: JSON.stringify(value), value });
const fresh = () => import(`../src/lib/appSettings.ts?write-test=${++serial}`);

test("batched monitor edits preserve every preview and browser field", async () => {
  const patches = [];
  const saved = structuredClone(DEFAULT_SETTINGS);
  saved.monitor.preview.agents = false;
  saved.monitor.preview.taskSummary = false;
  saved.monitor.browser.enabled = true;
  saved.monitor.browser.profile = "folder";
  mockIPC((command, args) => {
    if (command === "app_settings_read") return document(DEFAULT_SETTINGS);
    assert.equal(command, "app_settings_patch");
    patches.push(args.patch);
    return document(saved);
  });
  const settings = await fresh();
  await settings.loadSettings();
  settings.updateSettings({ monitor: { preview: { agents: false } } });
  settings.updateSettings({ monitor: { preview: { taskSummary: false } } });
  settings.updateSettings({ monitor: { browser: { enabled: true } } });
  settings.updateSettings({ monitor: { browser: { profile: "folder" } } });
  await settings.flushSettings();
  assert.equal(patches.length, 1);
  assert.deepEqual(patches[0].monitor.preview, { agents: false, taskSummary: false });
  assert.deepEqual(patches[0].monitor.browser, { enabled: true, profile: "folder" });
  assert.deepEqual(settings.settingsNow(), saved);
});

test("failed writes retain nested edits and newer choices win when retried", async () => {
  const entered = Promise.withResolvers();
  const writing = Promise.withResolvers();
  const patches = [];
  const saved = structuredClone(DEFAULT_SETTINGS);
  saved.monitor.preview.agents = true;
  saved.monitor.preview.taskSummary = false;
  saved.monitor.browser.enabled = true;
  saved.monitor.browser.profile = "folder";
  mockIPC(async (command, args) => {
    if (command === "app_settings_read") return document(DEFAULT_SETTINGS);
    assert.equal(command, "app_settings_patch");
    patches.push(args.patch);
    if (patches.length === 1) {
      entered.resolve();
      await writing.promise;
    }
    return document(saved);
  });
  const settings = await fresh();
  await settings.loadSettings();
  settings.updateSettings({ monitor: { preview: { agents: false }, browser: { enabled: true } } });
  const first = settings.flushSettings();
  await entered.promise;
  settings.updateSettings({
    monitor: { preview: { agents: true, taskSummary: false }, browser: { profile: "folder" } },
  });
  writing.reject(new Error("disk full"));
  await first;
  assert.match(settings.settingsError(), /disk full/);
  await settings.flushSettingsForHandoff();
  assert.deepEqual(patches[1].monitor.preview, { agents: true, taskSummary: false });
  assert.deepEqual(patches[1].monitor.browser, { enabled: true, profile: "folder" });
  assert.deepEqual(settings.settingsNow(), saved);
  assert.equal(settings.settingsError(), null);
});

test("a completed write preserves pending resume choices while the next save waits", async () => {
  const entered = Promise.withResolvers();
  const writing = Promise.withResolvers();
  const saved = structuredClone(DEFAULT_SETTINGS);
  saved.resume.prompt = "keep my custom prompt";
  let count = 0;
  mockIPC(async (command, args) => {
    if (command === "app_settings_read") return document(saved);
    assert.equal(command, "app_settings_patch");
    if (++count === 1) {
      entered.resolve();
      await writing.promise;
    }
    saved.resume = { ...saved.resume, ...args.patch.resume };
    return document(structuredClone(saved));
  });
  const settings = await fresh();
  await settings.loadSettings();
  settings.updateSettings({ resume: { within: 300 } });
  const first = settings.flushSettings();
  await entered.promise;
  settings.updateSettings({ resume: { within: 600 } });
  writing.resolve();
  await first;
  assert.equal(settings.settingsNow().resume.within, 600);
  assert.equal(settings.settingsNow().resume.prompt, "keep my custom prompt");
  await settings.flushSettings();
  assert.equal(saved.resume.within, 600);
});
