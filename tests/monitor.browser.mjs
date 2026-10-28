import assert from "node:assert/strict";

/** Agent cards and terminal tails, including updates with unchanged process metadata. */
export async function verifyMonitorCards(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/tests/fixtures/monitor.html`);
  await page.locator(".monitor-role").first().waitFor();
  const badges = page.locator(".monitor-badge");
  await page.locator('.monitor-badge [data-role="terminal"]').first().waitFor();
  assert.equal(await page.locator(".card-session-preview").count(), 0);
  assert.equal(await badges.count(), 4);
  for (const width of [1200, 800]) {
    await page.setViewportSize({ width, height: 850 });
    const folderHeader = page.locator(".fixture-cards [data-card-folder] > .page__header").first();
    assert.equal(
      await folderHeader.locator(".monitor-role, .card-workers").count(),
      0,
      "Folder headers do not combine unrelated agents' workers",
    );
    const sizes = await badges.evaluateAll((nodes) =>
      nodes.map((node) => ({
        width: node.clientWidth,
        content: node.scrollWidth,
        summary: node.querySelector(".monitor-badge__summary")?.clientWidth,
        height: node.offsetHeight,
        rows: node.querySelectorAll(".monitor-badge__row").length,
      })),
    );
    assert.ok(
      sizes.every((size) => size.content <= size.width + 1),
      JSON.stringify(sizes),
    );
    assert.ok(
      sizes.every((size) => size.summary >= 55),
      JSON.stringify(sizes),
    );
    assert.ok(
      sizes.every((size) => size.rows === 2 && size.height >= 28 && size.height <= 30),
      JSON.stringify(sizes),
    );
  }
  assert.equal(await badges.nth(2).getAttribute("data-status"), "failure");
  assert.equal(await badges.first().locator('[data-role="request"] svg').count(), 1);
  assert.equal(
    await badges.first().locator('.monitor-badge__row[data-status="running"]').count(),
    1,
  );
  const terminalRows = page.locator('.monitor-badge [data-role="terminal"]');
  assert.deepEqual(await terminalRows.allTextContents(), [
    "first output line",
    "  last output line",
  ]);
  for (const [tail, expected] of [
    ["updated output\n$ ", ["updated output", "$ "]],
    ["single line", ["single line", ""]],
    ["", ["", ""]],
    [`${"あ".repeat(200)}\n  ${"x".repeat(200)}`, ["あ".repeat(200), `  ${"x".repeat(200)}`]],
  ]) {
    await page.evaluate((tail) => window.monitorTail(tail), tail);
    await page.waitForFunction(
      (expected) =>
        JSON.stringify(
          [...document.querySelectorAll('.monitor-badge [data-role="terminal"]')].map(
            (node) => node.textContent,
          ),
        ) === JSON.stringify(expected),
      expected,
    );
    assert.deepEqual(await terminalRows.allTextContents(), expected);
  }
  assert.equal(
    await page
      .locator(".monitor-badge")
      .filter({ has: page.locator('[data-role="terminal"]') })
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
    true,
  );
  assert.equal(await page.locator(".MuiPopover-root").count(), 0);
  assert.deepEqual(errors, []);
}

/** Real settings, observer runtime and badges with only native IPC replaced. */
export async function verifyMonitor(page, base = "http://127.0.0.1:18422") {
  await verifyMonitorCards(page, base);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const badges = page.locator(".monitor-badge");
  const lastConfig = () =>
    page.evaluate(
      () =>
        window.monitorCalls.filter((call) => call.cmd === "monitor_configure").at(-1).payload
          .config,
    );
  const modelCalls = (agent) =>
    page.evaluate(
      (agent) =>
        window.monitorCalls.filter(
          (call) => call.cmd === "monitor_models" && call.payload.agent === agent,
        ).length,
      agent,
    );
  const model = page.getByRole("combobox", { name: "Model", exact: true });
  await model.waitFor();
  assert.equal(await model.inputValue(), "claude-sonnet");
  assert.equal(await page.getByRole("textbox", { name: "ACP command" }).count(), 0);
  await model.click();
  await page.getByRole("option", { name: /Opus/ }).click();
  await page.waitForFunction(
    () =>
      window.monitorCalls.filter((call) => call.cmd === "monitor_configure").at(-1).payload.config
        .model === "claude-opus",
  );
  // A model the list does not know is still accepted as typed.
  await model.fill("claude-preview");
  await page.keyboard.press("Tab");
  await page.waitForFunction(
    () =>
      window.monitorCalls.filter((call) => call.cmd === "monitor_configure").at(-1).payload.config
        .model === "claude-preview",
  );
  await page.getByRole("combobox", { name: "Coding agent" }).click();
  await page.getByRole("option", { name: "Codex", exact: true }).click();
  await page.getByText("codex: command not found", { exact: true }).waitFor();
  assert.equal((await lastConfig()).agent, "codex");
  assert.equal((await lastConfig()).model, "");
  assert.equal(await model.inputValue(), "");
  await model.fill("gpt-typed");
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      window.monitorCalls.filter((call) => call.cmd === "monitor_configure").at(-1).payload.config
        .model === "gpt-typed",
  );
  await page.getByRole("combobox", { name: "Coding agent" }).click();
  await page.getByRole("option", { name: "Custom ACP", exact: true }).click();
  await page.getByText("Set an ACP command for the custom agent to start monitoring.").waitFor();
  const command = page.getByRole("textbox", { name: "ACP command", exact: true });
  await command.fill("another-agent-acp");
  assert.equal((await lastConfig()).command, "");
  await page.getByRole("textbox", { name: "Arguments (JSON)" }).focus();
  await page.waitForFunction(
    () =>
      window.monitorCalls.filter((call) => call.cmd === "monitor_configure").at(-1).payload.config
        .command === "another-agent-acp",
  );
  await page.locator(".monitor-role").first().waitFor();
  await badges.first().click();
  const detail = page.locator(".MuiPopover-root");
  await detail.getByText("Add keyboard navigation to the editor", { exact: true }).waitFor();
  assert.equal(await detail.locator(".monitor-state").textContent(), "Running");
  assert.ok(await detail.getByText("Running 60%", { exact: true }).isVisible());
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Arguments (JSON)" }).fill("[invalid");
  await page.getByText("Use a JSON array of strings").waitFor();
  await page.getByRole("textbox", { name: "Arguments (JSON)" }).fill('["--acp"]');
  await model.focus();
  assert.equal(await page.getByText("Use a JSON array of strings").count(), 0);
  // The list is remembered per agent when returning to its settings.
  await page.getByRole("combobox", { name: "Coding agent" }).click();
  await page.getByRole("option", { name: "Claude Code", exact: true }).click();
  await model.click();
  await page.getByRole("option", { name: /Opus/ }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await modelCalls("claude"), 1);
  assert.equal(await page.getByRole("textbox", { name: "ACP command" }).count(), 0);
  await page.getByRole("checkbox", { name: "User request", exact: true }).first().uncheck();
  await page.locator(".monitor-role").first().waitFor();
  await badges.first().click();
  assert.equal(
    await detail.getByText("Add keyboard navigation to the editor", { exact: true }).count(),
    0,
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.monitorLanguage("ja"));
  await page.getByRole("checkbox", { name: "ユーザーの依頼", exact: true }).first().waitFor();
  await page.evaluate(() => window.monitorLanguage("en"));
  await page.getByRole("checkbox", { name: "Agents", exact: true }).first().uncheck();
  assert.equal(await page.locator(".monitor-role").count(), 0);
  await page.getByRole("checkbox", { name: "Enabled", exact: true }).uncheck();
  assert.equal(await badges.count(), 0);
  assert.deepEqual(errors, []);
}
