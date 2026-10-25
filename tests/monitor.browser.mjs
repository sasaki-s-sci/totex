import assert from "node:assert/strict";

/** Agent cards and terminal tails, including updates with unchanged process metadata. */
export async function verifyMonitorCards(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/tests/fixtures/monitor.html`);
  await page.locator(".monitor-role").first().waitFor();
  const badges = page.locator(".monitor-badge");
  await page.locator('.fixture-terminal [data-role="terminal"]').first().waitFor();
  assert.equal(await badges.count(), 5);
  for (const width of [1200, 800]) {
    await page.setViewportSize({ width, height: 850 });
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
  assert.equal(
    await page
      .locator(".fixture-graph .tile")
      .first()
      .evaluate((node) => node.offsetWidth),
    220,
  );
  const lefts = await page
    .locator(".fixture-graph .monitor-badge")
    .evaluateAll((nodes) =>
      nodes.map(
        (node) =>
          node.closest(".tile")?.getBoundingClientRect().left ?? node.getBoundingClientRect().left,
      ),
    );
  assert.ok(Math.abs(lefts[0] - lefts[1]) < 1, JSON.stringify(lefts));
  await page.evaluate(() => window.monitorSummaries(false));
  await page.waitForFunction(
    () =>
      !document.querySelector(
        '.monitor-badge--canvas [data-role="request"] .monitor-badge__summary',
      ),
  );
  for (const [width, wide, ascii] of [
    [160, 17, 29],
    [220, 24, 42],
    [320, 37, 64],
    [420, 49, 85],
  ]) {
    await page.evaluate((width) => window.monitorWidth(width), width);
    const canvas = page.locator(".fixture-graph .tile").first();
    await page.waitForFunction(
      (width) =>
        document.querySelector(".monitor-badge--canvas")?.getAttribute("data-width") ===
        String(width),
      width,
    );
    assert.equal(await canvas.evaluate((node) => node.offsetWidth), width);
    assert.equal(await canvas.evaluate((node) => node.offsetHeight), 32);
    assert.ok(
      await canvas.evaluate(
        (node) => getComputedStyle(node).backgroundColor === "rgba(0, 0, 0, 0)",
      ),
    );
    // The prompt's text budgets must fit the actual default font, including the row icon.
    const measured = await canvas.evaluate(
      (node, [wide, ascii]) => {
        const badge = node.querySelector(".monitor-badge");
        const context = document.createElement("canvas").getContext("2d");
        context.font = getComputedStyle(badge).font;
        return {
          available: badge.querySelector(".monitor-badge__row").clientWidth - 11,
          wide: context.measureText("あ".repeat(wide)).width,
          ascii: context.measureText(
            "Add keyboard navigation and check focus behavior. ".repeat(3).slice(0, ascii),
          ).width,
        };
      },
      [wide, ascii],
    );
    assert.ok(measured.wide <= measured.available, JSON.stringify(measured));
    assert.ok(measured.ascii <= measured.available, JSON.stringify(measured));
  }
  await page.evaluate(() => window.monitorWidth(220));
  await page.evaluate(() => window.monitorSummaries(true));
  await page.waitForFunction(() =>
    Boolean(
      document.querySelector(
        '.monitor-badge--canvas [data-role="request"] .monitor-badge__summary',
      ),
    ),
  );
  const terminalRows = page.locator('.fixture-terminal [data-role="terminal"]');
  assert.deepEqual(await terminalRows.allTextContents(), [
    "first output line",
    "  last output line",
  ]);
  assert.equal(
    await page.locator(".fixture-terminal .tile").evaluate((node) => node.offsetHeight),
    32,
  );
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
          [...document.querySelectorAll('.fixture-terminal [data-role="terminal"]')].map(
            (node) => node.textContent,
          ),
        ) === JSON.stringify(expected),
      expected,
    );
    assert.deepEqual(await terminalRows.allTextContents(), expected);
  }
  assert.equal(
    await page
      .locator(".fixture-terminal .monitor-badge")
      .evaluate((node) => node.scrollWidth <= node.clientWidth),
    true,
  );
  await page.setViewportSize({ width: 1200, height: 850 });
  const numbers = await page
    .locator(".fixture-graph .edge__number textPath")
    .evaluateAll((labels) =>
      labels.map((label) => ({
        text: label.textContent,
        length: document.getElementById(label.getAttribute("href").slice(1)).getTotalLength(),
      })),
    );
  assert.deepEqual(
    numbers.map((label) => label.text),
    ["1", "2"],
  );
  assert.ok(numbers.every((label) => label.length > 0));
  assert.equal(await page.locator(".cli__number").count(), 0);
  await page.evaluate(() => window.monitorOffers(true));
  const offer = page.getByRole("button", { name: "Open a shell on empty", exact: true });
  await offer.waitFor();
  const offered = await offer.boundingBox();
  const existing = await page.locator(".fixture-graph .tile").first().boundingBox();
  assert.ok(Math.abs(offered.x - existing.x) < 1);
  assert.ok(Math.abs(offered.width - existing.width) < 1);
  assert.equal(await offer.evaluate((node) => getComputedStyle(node).borderStyle), "dashed");
  await offer.click();
  assert.deepEqual(await page.evaluate(() => window.monitorOpened), ["/tmp/empty"]);
  await page.evaluate(() => window.monitorOffers(false));
  const cards = page.locator(".fixture-graph .tile");
  for (let at = 0; at < 2; at++) {
    const card = cards.nth(at);
    const close = card.locator(".cli__end");
    await card.hover();
    const box = await card.boundingBox();
    const end = await close.boundingBox();
    assert.ok(end.x > box.x + box.width);
    assert.ok(Math.abs(end.y + end.height / 2 - box.y - box.height / 2) < 1);
    if (at === 0) await close.click();
    else {
      await close.focus();
      await close.press("Enter");
    }
  }
  assert.deepEqual(await page.evaluate(() => window.monitorEnded), ["running", "terminal"]);
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
