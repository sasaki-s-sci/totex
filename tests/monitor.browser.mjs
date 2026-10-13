import assert from "node:assert/strict";

/** Real settings, observer runtime and badges with only native IPC replaced. */
export async function verifyMonitor(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/tests/fixtures/monitor.html`);
  await page.locator(".monitor-role").first().waitFor();
  const badges = page.locator(".monitor-badge");
  assert.equal(await badges.count(), 4);
  for (const width of [1200, 800]) {
    await page.setViewportSize({ width, height: 850 });
    const sizes = await badges.evaluateAll((nodes) =>
      nodes.map((node) => ({
        width: node.clientWidth,
        content: node.scrollWidth,
        summary: node.querySelector(".monitor-badge__summary")?.clientWidth,
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
  }
  assert.match(await badges.nth(2).innerText(), /Failed/);
  assert.equal(
    await page.locator(".monitor-badge--canvas").evaluate((node) => node.clientWidth),
    220,
  );
  const command = page.getByRole("textbox", { name: "ACP command", exact: true });
  await command.fill("another-agent-acp");
  assert.equal(
    await page.evaluate(
      () =>
        window.monitorCalls.filter((call) => call.cmd === "monitor_configure").at(-1).payload.config
          .command,
    ),
    "agent-acp",
  );
  await page.getByRole("textbox", { name: "Model", exact: true }).focus();
  await page.waitForFunction(
    () =>
      window.monitorCalls.filter((call) => call.cmd === "monitor_configure").at(-1).payload.config
        .command === "another-agent-acp",
  );
  await page.locator(".monitor-role").first().waitFor();
  await badges.first().click();
  await page.getByText("Add keyboard navigation to the editor", { exact: true }).waitFor();
  assert.ok(await page.getByText("Running · Inferred", { exact: true }).isVisible());
  assert.ok(await page.getByText("Running 60%", { exact: true }).isVisible());
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Arguments (JSON)" }).fill("[invalid");
  await page.getByText("Use a JSON array of strings").waitFor();
  await page.getByRole("textbox", { name: "Arguments (JSON)" }).fill('["--acp"]');
  await page.getByRole("textbox", { name: "Model", exact: true }).focus();
  assert.equal(await page.getByText("Use a JSON array of strings").count(), 0);
  await page.getByRole("checkbox", { name: "User request", exact: true }).uncheck();
  await page.locator(".monitor-role").first().waitFor();
  await badges.first().click();
  assert.equal(
    await page.getByText("Add keyboard navigation to the editor", { exact: true }).count(),
    0,
  );
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.monitorLanguage("ja"));
  await page.getByRole("checkbox", { name: "ユーザーの依頼", exact: true }).waitFor();
  await page.evaluate(() => window.monitorLanguage("en"));
  await page.getByRole("checkbox", { name: "Agents", exact: true }).uncheck();
  assert.equal(await page.locator(".monitor-role").count(), 0);
  await page.getByRole("checkbox", { name: "Enabled", exact: true }).uncheck();
  assert.equal(await badges.count(), 0);
  assert.deepEqual(errors, []);
}
