import assert from "node:assert/strict";

export async function verifyReplies(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem("totex.language", "ja");
    let serial = 0;
    const callbacks = new Map();
    const listeners = new Map();
    window.__TAURI_INTERNALS__ = {
      transformCallback(callback) {
        callbacks.set(++serial, callback);
        return serial;
      },
      unregisterCallback(id) {
        callbacks.delete(id);
      },
      async invoke(cmd, args) {
        if (cmd === "plugin:event|listen") {
          const id = ++serial;
          listeners.set(id, args);
          return id;
        }
        if (cmd === "plugin:event|unlisten") {
          listeners.delete(args.eventId);
          return;
        }
        if (cmd === "overseer_session") return "monitor";
        return [];
      },
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.replyEmit = (event, payload) => {
      for (const [id, listener] of listeners)
        if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
    };
  });
  await page.goto(`${base}/tests/fixtures/replies.html`);
  await page.waitForFunction(() => typeof window.replyEmit === "function");
  await page.waitForTimeout(200);
  const send = async (key, status, text, truncated = false) =>
    page.evaluate(
      ({ key, status, text, truncated }) => {
        window.replyEmit("mcp:report", {
          id: "terminal",
          report: {
            doing: "古い進捗",
            steps: [],
            reply: { key, agent: "codex", sessionId: "s", turnId: key, status, text, truncated },
          },
        });
      },
      { key, status, text, truncated },
    );
  const body = "最終返信\n日本語の本文\n```code```\n<script>window.replyExecuted = true</script>";
  await send("first", "completed", body);
  await page.getByText("返信完了", { exact: true }).waitFor();
  await page.getByRole("button", { name: "返信本文を読む" }).click();
  assert.equal(await page.getByRole("dialog").locator("pre").textContent(), body);
  assert.equal(await page.evaluate(() => window.replyExecuted), undefined);
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    window.replyEmit("overseer:status", { id: "terminal", status: "要約済み", replyKey: "first" }),
  );
  await page.getByText("要約済み", { exact: true }).waitFor();
  await send("second", "completed", "次の返信本文");
  await page.locator(".report__doing").filter({ hasText: "次の返信本文" }).waitFor();
  assert.equal(await page.getByText("要約済み", { exact: true }).count(), 0);
  await send("third", "inProgress", "");
  await page.getByText("応答中", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "返信本文を読む" }).count(), 0);
  await send("third-failure", "failed", "API error", true);
  await page.getByText("失敗", { exact: true }).waitFor();
  await page.getByRole("button", { name: "返信本文を読む" }).click();
  await page.getByText("長い返信のため、本文の一部を省略しています。", { exact: true }).waitFor();
  assert.equal(errors.length, 0, errors.join("\n"));
  return {
    passed:
      "reply card status, exact body, stale summary rejection, new turn clearing, failure and truncation",
    errors,
  };
}
