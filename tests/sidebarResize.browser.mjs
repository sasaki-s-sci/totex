import assert from "node:assert/strict";
import { installCanvasNative } from "./fixtures/canvas-native.mjs";

/** Real sidebars, editor, terminal and iframe; only native IPC is replaced. */
export async function verifySidebarResize(page, base = "http://127.0.0.1:18422") {
  await installCanvasNative(page);
  await page.addInitScript(() => {
    if (window.top !== window) return;
    localStorage.setItem("totex.panel.width", "420");
    localStorage.setItem("totex.sidebarWidth", "288");
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  const editor = page.getByRole("textbox", { name: "note.txt", exact: true });
  const terminal = page.locator('[data-terminal="terminal-one"] .xterm-helper-textarea');
  const panel = (id) => page.locator(`#${id}`);
  const grip = (id) => panel(id).getByRole("separator", { name: "Width", exact: true });
  const width = (id) =>
    panel(id).evaluate((node) => Number.parseFloat(getComputedStyle(node).width));
  const focused = (node) => node.evaluate((node) => document.activeElement === node);
  const reset = async () => {
    await page.goto(`${base}/tests/fixtures/pages.html?canvas&grouped&mixed&terminal-resize`);
    await editor.waitFor();
    await terminal.waitFor();
    await page.locator('[data-canvas-pane="live"] iframe').waitFor();
  };
  const start = async (id, y = 750) => {
    const box = await grip(id).boundingBox();
    const x = box.x + box.width / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    return x;
  };
  const released = async (id, expected) => {
    assert.equal(await grip(id).evaluate((node) => node.hasPointerCapture(1)), false);
    await page.mouse.move(850, 700);
    assert.equal(await width(id), expected, "A released drag cannot resize on later pointer moves");
    assert.equal(await page.evaluate(() => document.body.style.userSelect), "");
  };

  await reset();
  for (const id of ["folder-sidebar", "cli-sidebar"]) {
    const direction = id === "folder-sidebar" ? 1 : -1;
    for (const input of [editor, terminal]) {
      await input.focus();
      const before = await width(id);
      const x = await start(id);
      assert.equal(await focused(input), true, "Grabbing either sidebar preserves typing focus");
      await page.mouse.move(x + direction * 24, 750, { steps: 6 });
      await page.mouse.up();
      assert.equal(await width(id), before + 24);
      assert.equal(await focused(input), true, "Releasing either sidebar preserves typing focus");
      await released(id, before + 24);
    }

    await grip(id).focus();
    const before = await width(id);
    await page.keyboard.press("ArrowRight");
    assert.equal(await width(id), before + direction * 16);
    await page.keyboard.press("ArrowLeft");
    assert.equal(await width(id), before);
    assert.equal(await focused(grip(id)), true, "Keyboard resizing keeps the separator focused");
  }

  for (const id of ["folder-sidebar", "cli-sidebar"]) {
    await reset();
    await editor.focus();
    const before = await width(id);
    await start(id, 200);
    const destination = id === "folder-sidebar" ? 700 : 550;
    await page.mouse.move(destination, 200);
    assert.equal(
      await page.evaluate((x) => document.elementFromPoint(x, 200)?.tagName, destination),
      "IFRAME",
      "The release crosses the embedded page, outside the sidebar",
    );
    await page.mouse.up();
    const after = await width(id);
    assert.ok(after > before, "Dragging across the iframe still resizes the sidebar");
    await released(id, after);
    assert.equal(await focused(editor), true);
  }

  for (const id of ["folder-sidebar", "cli-sidebar"]) {
    for (const ending of ["pointercancel", "lostpointercapture", "blur", "buttons", "outside"]) {
      await reset();
      await terminal.focus();
      const x = await start(id);
      await page.mouse.move(x + 24, 750);
      const before = await width(id);
      if (ending === "outside") {
        await page.mouse.move(x + 24, -40);
        await page.mouse.up();
      } else if (ending === "lostpointercapture") {
        await grip(id).evaluate((node) => node.releasePointerCapture(1));
      } else if (ending === "blur") {
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      } else {
        await grip(id).dispatchEvent(ending === "buttons" ? "pointermove" : ending, {
          pointerId: 1,
          isPrimary: true,
          buttons: 0,
        });
      }
      await page.mouse.move(x + 80, 750);
      await page.mouse.up();
      assert.equal(await width(id), before, `${ending} ends resizing immediately`);
      await released(id, before);
      assert.equal(await focused(terminal), true, `${ending} preserves terminal focus`);
    }
  }

  await reset();
  await editor.focus();
  const left = await width("folder-sidebar");
  const box = await grip("folder-sidebar").boundingBox();
  await page.mouse.move(box.x + box.width / 2, 750);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + 60, 750);
  await page.mouse.up({ button: "right" });
  assert.equal(await width("folder-sidebar"), left, "Only the primary button starts resizing");

  await page.setViewportSize({ width: 900, height: 900 });
  await reset();
  assert.equal(await width("cli-sidebar"), 360);
  const x = await start("cli-sidebar");
  await page.mouse.move(x + 30, 750, { steps: 6 });
  await page.mouse.up();
  assert.equal(
    await width("cli-sidebar"),
    330,
    "Dragging starts from the visible CSS-capped width",
  );
  assert.equal(await page.evaluate(() => localStorage.getItem("totex.panel.width")), "330");
  await reset();
  await grip("cli-sidebar").focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(await width("cli-sidebar"), 344, "Keyboard resizing also starts from visible width");
  return "Sidebar focus, iframe/outside release, cancellation cleanup and CSS-capped pointer/keyboard width";
}
