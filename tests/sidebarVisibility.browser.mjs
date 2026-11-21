import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

function pdfData() {
  const stream = "BT /F1 24 Tf 30 150 Td (Sidebar resource) Tj ET\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 6\n0000000000 65535 f \n`;
  text += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  text += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return { data: Buffer.from(text).toString("base64"), size: text.length };
}

/** Both closed panels leave the real iframe/PDF canvas usable, without replacing terminals. */
export async function verifySidebarVisibility(page, base = "http://127.0.0.1:18422") {
  await installCanvasNative(page);
  await page.addInitScript((pdf) => {
    if (window.top !== window) return;
    window.canvasStates["terminal-one"].panes.push({
      id: "pdf",
      kind: "file",
      path: "/tmp/sample.pdf",
      view: "preview",
    });
    const invoke = window.__TAURI_INTERNALS__.invoke;
    window.__TAURI_INTERNALS__.invoke = (cmd, args) =>
      cmd === "read_file_data" && args.path === "/tmp/sample.pdf"
        ? Promise.resolve({ path: args.path, name: "sample.pdf", ...pdf })
        : invoke(cmd, args);
  }, pdfData());
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&mixed&terminal-resize`);
  const panel = (side) => page.locator(side === "left" ? "#folder-sidebar" : "#cli-sidebar");
  const reopen = (side) => page.locator(`[data-sidebar-reopen="${side}"] button`);
  const active = () =>
    page.locator("[data-session-canvas]:not([hidden])").getAttribute("data-session-canvas");
  const hideRight = () =>
    page.getByRole("button", { name: "Hide page sidebar", exact: true }).click();
  const hideLeft = () =>
    page.getByRole("button", { name: "Collapse root folders", exact: true }).click();
  const assertAbove = async (side) => {
    await reopen(side).waitFor();
    const state = await reopen(side).evaluate((button) => {
      const box = button.getBoundingClientRect();
      return {
        top: box.top,
        width: box.width,
        height: box.height,
        receives: button.contains(
          document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
        ),
      };
    });
    assert.deepEqual(state, { top: 8, width: 24, height: 24, receives: true });
  };
  const expand = async (id) => {
    await page.locator(`[data-canvas-pane="${id}"]`).focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Expand", exact: true }).click();
    await page.locator(".MuiMenu-root").waitFor({ state: "detached" });
    await page.getByRole("dialog").waitFor();
  };
  const ready = () =>
    page.waitForFunction(() =>
      ["terminal-one", "terminal-two", "terminal-other"].every((id) => {
        const terminal = window.pageTerminals?.get(id);
        return (
          terminal?.rows > 2 &&
          terminal.buffer.active.getLine(0)?.translateToString(true) === "Retained terminal"
        );
      }),
    );
  await ready();
  await page.getByRole("img", { name: "sample.pdf — 1", exact: true }).waitFor();
  const live = page.frame({ url: "http://127.0.0.1:18424/live" });
  await live.getByRole("button", { name: "Count 0", exact: true }).click();
  const mount = await live.evaluate(() => window.canvasFixtureMount);
  await page.evaluate(() => {
    window.sidebarTerminals = [...window.pageTerminals].map(([id, terminal]) => ({
      id,
      terminal,
      element: terminal.element,
    }));
    window.sidebarAttachCount = window.pageCalls.filter(({ cmd }) => cmd === "pty_attach").length;
  });

  await hideLeft();
  await hideRight();
  await panel("left").waitFor({ state: "hidden" });
  await panel("right").waitFor({ state: "hidden" });
  assert.equal((await page.locator("main").first().boundingBox()).width, 1440);
  assert.equal(await active(), "terminal-one");
  await assertAbove("left");
  await assertAbove("right");
  await live.getByRole("button", { name: "Count 1", exact: true }).click();

  await expand("pdf");
  await assertAbove("left");
  await assertAbove("right");
  await reopen("right").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await panel("right").waitFor();
  assert.equal(await active(), "terminal-one");
  await hideRight();
  await expand("live");
  await assertAbove("left");
  await assertAbove("right");
  await reopen("left").click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await panel("left").waitFor();
  await panel("right").waitFor({ state: "hidden" });
  assert.equal(await live.evaluate(() => window.canvasFixtureMount), mount);
  await live.getByRole("button", { name: "Count 2", exact: true }).waitFor();

  await reopen("right").click();
  await page.locator('[data-terminal-shown="true"] .xterm-helper-textarea').focus();
  await page.keyboard.press("Control+2");
  assert.equal(await active(), "terminal-two");
  await hideRight();
  assert.equal(await active(), "terminal-two");
  await reopen("right").click();
  assert.equal(await active(), "terminal-two", "Reopening retains the selected terminal's canvas");
  await hideRight();
  await reopen("right").focus();
  await page.keyboard.press("Control+2");
  await panel("right").waitFor();
  assert.equal(await active(), "terminal-two", "Showing the same terminal by keyboard reopens it");
  assert.equal(
    await page.evaluate(
      () =>
        window.sidebarTerminals.every(
          ({ id, terminal, element }) =>
            window.pageTerminals.get(id) === terminal && terminal.element === element,
        ) &&
        window.pageCalls.filter(({ cmd }) => cmd === "pty_attach").length ===
          window.sidebarAttachCount &&
        !window.pageCalls.some(({ cmd }) => cmd === "pty_close"),
    ),
    true,
    "Closing panels retains the original terminals and attachments",
  );

  await page.goto(
    `${base}/tests/fixtures/pages.html?canvas&grouped&onlyterminals&terminal-resize&sidebar-closed`,
  );
  await panel("right").waitFor({ state: "hidden" });
  await ready();
  await assertAbove("right");
  await reopen("right").click();
  await panel("right").waitFor();
  assert.equal(await active(), "terminal-one");
  return "Both sidebar collapse/reopen controls, iframe/PDF top layer, current canvas, keyboard reopening and hidden-startup attachment";
}
