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
  await page.getByText("From WSL · Ubuntu-24.04", { exact: true }).waitFor();
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
  await page.getByText("From SSH · another-agent-acp", { exact: true }).waitFor();
  await page.locator(".monitor-role").first().waitFor();
  await badges.first().click();
  await page.getByText("Add keyboard navigation to the editor", { exact: true }).waitFor();
  assert.ok(await page.getByText("Running · Inferred", { exact: true }).isVisible());
  assert.ok(await page.getByText("Running 60%", { exact: true }).isVisible());
  assert.ok(await page.getByText("another-agent-acp · Agent default", { exact: true }).isVisible());
  await page.keyboard.press("Escape");
  await page.getByRole("textbox", { name: "Arguments (JSON)" }).fill("[invalid");
  await page.getByText("Use a JSON array of strings").waitFor();
  await page.getByRole("textbox", { name: "Arguments (JSON)" }).fill('["--acp"]');
  await model.focus();
  assert.equal(await page.getByText("Use a JSON array of strings").count(), 0);
  // The list is remembered per agent, and only the refresh button asks again.
  await page.getByRole("combobox", { name: "Coding agent" }).click();
  await page.getByRole("option", { name: "Claude Code", exact: true }).click();
  await page.getByText("From WSL · Ubuntu-24.04", { exact: true }).waitFor();
  assert.equal(await modelCalls("claude"), 1);
  await page.getByRole("button", { name: "Reload models" }).click();
  await page.waitForFunction(
    () =>
      window.monitorCalls.filter(
        (call) => call.cmd === "monitor_models" && call.payload.agent === "claude",
      ).length === 2,
  );
  await page.getByText("From WSL · Ubuntu-24.04", { exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "ACP command" }).count(), 0);
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
