import assert from "node:assert/strict";

/** Runs in the page-placement fixture after its terminal, editor and settings have mounted. */
export async function verifyCardLayout(page) {
  const layout = page.locator(".settings-page").getByRole("group", { name: "Layout", exact: true });
  await page.evaluate(() => {
    window.cardIdentity = {
      terminal: document.querySelector('[data-terminal="terminal-one"]'),
      editor: document.querySelector('[role="textbox"][aria-label="note.txt"]'),
      settings: document.querySelector(".settings-page input"),
      attaches: window.pageCalls.filter((call) => call.cmd === "pty_attach").length,
    };
  });
  await layout.getByRole("button", { name: "Cards", exact: true }).click();
  await page.getByRole("article", { name: "/tmp", exact: true }).waitFor();
  const heading = page.getByRole("article", { name: "/tmp", exact: true }).locator("h3");
  const initialSize = await heading.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize),
  );
  const cardSize = page.getByRole("slider", { name: "Card text size", exact: true });
  await cardSize.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction((initial) => {
    const heading = document.querySelector('[data-card-folder="/tmp"] h3');
    return heading && parseFloat(getComputedStyle(heading).fontSize) > initial;
  }, initialSize);
  await page.keyboard.press("ArrowLeft");

  await page.getByRole("button", { name: "Open terminal in card", exact: true }).click();
  await page.locator('.card-board [data-terminal="terminal-one"] .xterm-screen').waitFor();
  assert.ok(
    await page.evaluate(
      () =>
        window.cardIdentity.terminal ===
          document.querySelector('.card-board [data-terminal="terminal-one"]') &&
        window.cardIdentity.editor ===
          document.querySelector('.card-board [role="textbox"][aria-label="note.txt"]') &&
        window.cardIdentity.settings === document.querySelector(".card-board .settings-page input"),
    ),
    "Moving to cards keeps the mounted terminal, editor and settings",
  );
  await layout.getByRole("button", { name: "Canvas", exact: true }).click();
  await page
    .locator('.react-flow__node-cli-page [data-terminal="terminal-one"] .xterm-screen')
    .waitFor();
  assert.ok(
    await page.evaluate(
      () =>
        window.cardIdentity.terminal === document.querySelector('[data-terminal="terminal-one"]') &&
        window.cardIdentity.attaches ===
          window.pageCalls.filter((call) => call.cmd === "pty_attach").length,
    ),
    "Returning to canvas does not recreate the terminal or reattach its shell",
  );
  await page.getByRole("button", { name: "Move main to the sidebar", exact: true }).click();
  await page.locator('#cli-sidebar [data-terminal="terminal-one"] .xterm-screen').waitFor();
}

/** Uses the native IPC stub installed by the page-placement fixture. */
export async function verifyCardOffers(page, base = "http://127.0.0.1:18422") {
  await page.goto(`${base}/tests/fixtures/pages.html?offers`);
  await page
    .locator(".settings-page")
    .getByRole("group", { name: "Layout", exact: true })
    .getByRole("button", { name: "Cards", exact: true })
    .click();
  await page.locator('[data-card-folder="/empty-a"]').waitFor();
  await page.locator('[data-terminal="terminal-one"] .xterm-screen').click();
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-card-offered]")?.getAttribute("data-card-folder") ===
      "/empty-a",
  );
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-card-offered]")?.getAttribute("data-card-folder") ===
      "/empty-b",
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    window.pageCalls.some((call) => call.cmd === "pty_open" && call.args.cwd === "/empty-b"),
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, shiftKey: true, repeat: true }),
    ),
  );
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  assert.equal(await page.locator("[data-card-offered]").count(), 0);
  assert.equal(
    await page.evaluate(
      () =>
        window.pageCalls.filter((call) => call.cmd === "pty_open" && call.args.cwd === "/empty-a")
          .length,
    ),
    0,
  );
  // Ordinary editor selections keep Ctrl+Shift; they must not offer a terminal.
  await page.getByRole("textbox", { name: "note.txt", exact: true }).click();
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  assert.equal(await page.locator("[data-card-offered]").count(), 0);
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
}
