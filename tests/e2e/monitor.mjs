import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { waitFor } from "./runtime.mjs";

/** Native app, real PTY, ACP subprocess, and the production stdio MCP server. */
export async function monitor(browser, step, { log, control, settings }) {
  const records = () =>
    existsSync(log)
      ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
      : [];
  const saved = () => JSON.parse(readFileSync(settings, "utf8")).monitor;
  const click = async (selector) => {
    const element = await browser.$(selector);
    await element.waitForExist();
    await element.scrollIntoView({ block: "center" });
    await element.click();
  };
  const openSettings = async () => {
    await click('[aria-label="Hide page sidebar"]');
    await click('[aria-label="Settings"]');
    await click('[aria-label="Move totex.json to the sidebar"]');
  };
  const closeSettings = async () => {
    await click('[aria-label="Close totex.json"]');
    await click(".cli__open");
  };
  const badge = () => browser.$(".cli-page .monitor-badge");
  const openDetail = async () => {
    await badge().waitForDisplayed();
    await badge().click();
  };
  const closeDetail = async () => {
    await browser.keys("Escape");
    await browser.$(".MuiPopover-root").waitForExist({ reverse: true });
  };
  const refresh = () => click("button=Refresh");

  await step("Monitor: 実PTYに監視対象を出力し、Settingsから有効化", async () => {
    await click('[aria-label="Close terminal-proof.txt"]');
    // Zoom the canvas out through actual wheel input so the Settings header
    // fits before moving its page into the sidebar.
    await browser.performActions([
      {
        type: "wheel",
        id: "monitor-wheel",
        actions: [{ type: "scroll", x: 600, y: 320, deltaX: 0, deltaY: 1000, duration: 300 }],
      },
    ]);
    await click('[data-branch="main"] .head__cli');
    await browser.$(".xterm-helper-textarea").waitForExist();
    await click(".xterm-screen");
    const command =
      "printf 'MONITOR_NATIVE_E2E: user requests real monitor verification; task implement native monitor verification; goal active; subagent Tests 45%%; background Build 70%%; estimate 180 seconds\\n'";
    await browser.performActions([
      {
        type: "key",
        id: "monitor-keyboard",
        actions: [...command].flatMap((value) => [
          { type: "keyDown", value },
          { type: "keyUp", value },
        ]),
      },
    ]);
    await browser.keys("Enter");
    await openSettings();
    await click('input[aria-label="Enabled"]');
    await waitFor(() => saved().enabled, "Monitor setting persisted by Rust");
    await closeSettings();
    await browser.waitUntil(
      async () =>
        (await badge().getAttribute("title"))?.includes("Implement native monitor verification"),
      { timeout: 30000 },
    );
    assert.ok(records().some((record) => record.event === "model"));
    assert.ok(
      records().some(
        (record) => record.event === "session" && record.transcript.includes("MONITOR_NATIVE_E2E"),
      ),
    );
  });

  await step("Monitor: 要約・Goal・子Agent・進捗・推定時間を表示", async () => {
    await openDetail();
    const body = await browser.$("body").getText();
    for (const expected of [
      "Verify monitor through a real terminal",
      "Implement native monitor verification",
      "Complete native monitor checks",
      "45%",
      "70%",
      "≈ 3 min",
      "subagent 1",
      "background 1",
    ])
      assert.ok(body.includes(expected), `Missing Monitor detail: ${expected}`);
    assert.equal(await badge().getAttribute("data-status"), "running");
    assert.equal((await browser.$$(".monitor-agent")).length, 4);
  });

  await step("Monitor: 機能OFFをUI・prompt・MCP toolsに反映", async () => {
    await closeDetail();
    const start = records().length;
    await openSettings();
    await click('input[aria-label="Time estimate"]');
    await waitFor(() => saved().features.estimate === false, "estimate setting persisted");
    await closeSettings();
    await waitFor(
      () =>
        records()
          .slice(start)
          .some((record) => record.event === "report" && !("estimate" in record.report)),
      "disabled estimate removed from MCP report",
    );
    assert.ok(
      records()
        .slice(start)
        .some((record) => record.event === "session" && !record.tools.includes("report_estimate")),
    );
    await openDetail();
    assert.ok(!(await browser.$("body").getText()).includes("≈ 3 min"));
  });

  await step("Monitor: 無効化で実行中ACPを終了し専用folderを削除", async () => {
    writeFileSync(control, "stall");
    await refresh();
    await waitFor(
      () => records().some((record) => record.event === "stall"),
      "ACP observation entered pending state",
    );
    const stalled = records().findLast((record) => record.event === "stall");
    await closeDetail();
    await openSettings();
    await click('input[aria-label="Enabled"]');
    await waitFor(() => saved().enabled === false, "Monitor disabled setting persisted");
    await waitFor(
      () => !existsSync(`/proc/${stalled.pid}`) && !existsSync(stalled.cwd),
      "observer process and private workspace removed",
    );
    assert.equal((await browser.$$(".monitor-badge")).length, 0);
    writeFileSync(control, "report");
    await closeSettings();
  });

  await step("Monitor: 不正なACPコマンドを失敗表示し古い成功を残さない", async () => {
    await openSettings();
    const command = await browser.$('input[aria-label="ACP command"]');
    await command.scrollIntoView({ block: "center" });
    await command.click();
    await browser.performActions([
      {
        type: "key",
        id: "monitor-keyboard",
        actions: [
          { type: "keyDown", value: "\uE009" },
          { type: "keyDown", value: "a" },
          { type: "keyUp", value: "a" },
          { type: "keyUp", value: "\uE009" },
          ...[..."/totex-e2e-missing-agent"].flatMap((value) => [
            { type: "keyDown", value },
            { type: "keyUp", value },
          ]),
        ],
      },
    ]);
    await browser.keys("Enter");
    await waitFor(
      () => saved().command === "/totex-e2e-missing-agent",
      "invalid ACP command persisted",
    );
    await click('input[aria-label="Enabled"]');
    await closeSettings();
    await browser.waitUntil(async () => (await badge().getAttribute("data-status")) === "failure", {
      timeout: 30000,
    });
    assert.ok((await badge().getProperty("textContent")).includes("Failed"));
    assert.ok(
      !(await badge().getAttribute("title"))?.includes("Implement native monitor verification"),
    );
    await openDetail();
    assert.ok((await browser.$("body").getText()).includes("monitor Failed"));
  });
  await closeDetail();
  await openSettings();
  await click('input[aria-label="Enabled"]');
  await closeSettings();
}
