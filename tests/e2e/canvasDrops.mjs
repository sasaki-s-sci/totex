import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Runs after smoke has closed the last terminal; uses real WebKit pointer input and file IO. */
export async function canvasDrops(browser, repository, step) {
  const path = join(repository, "drop-test.png");
  writeFileSync(
    path,
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOQ8LL+DwACuAGd8psO1AAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  const file = await browser.$(`[data-pick-row="${path}"]`);
  await file.waitForDisplayed();
  const drag = async (target, edge = false) => {
    const from = await file.getLocation();
    const source = await file.getSize();
    const to = await target.getLocation();
    const bounds = await target.getSize();
    const x = Math.round(from.x + source.width / 2);
    const y = Math.round(from.y + source.height / 2);
    await browser.performActions([
      {
        type: "pointer",
        id: "file-drag",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", duration: 0, origin: "viewport", x, y },
          { type: "pointerDown", button: 0 },
          { type: "pointerMove", duration: 150, origin: "viewport", x: x + 10, y },
          {
            type: "pointerMove",
            duration: 400,
            origin: "viewport",
            x: Math.round(to.x + (edge ? 2 : bounds.width / 2)),
            y: Math.round(to.y + bounds.height / 2),
          },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
  };
  await step("ターミナル未起動でも画像DnDで表示先を作る", async () => {
    assert.equal((await browser.$$("[data-session-canvas]")).length, 0);
    await drag(await browser.$(".layout-bounds"));
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const image = document.querySelector(".session-canvas:not([hidden]) img");
          return image?.complete && image.naturalWidth === 1;
        }),
      { timeout: 20000, timeoutMsg: "The dropped image did not render in WebKit" },
    );
    assert.equal((await browser.$$("[data-session-canvas]")).length, 1);
    assert.equal((await browser.$$("[data-canvas-pane]")).length, 1);
  });
  await step("画像DnDでページを左右に分割する", async () => {
    await drag(await browser.$(".session-canvas:not([hidden])"), true);
    await browser.waitUntil(
      () =>
        browser.execute(() => {
          const canvas = document.querySelector(".session-canvas:not([hidden])");
          const panes = [...canvas.querySelectorAll("[data-canvas-pane]")];
          return (
            panes.length === 2 &&
            panes.every((pane) => {
              const image = pane.querySelector("img");
              return (
                image?.complete &&
                image.naturalWidth === 1 &&
                Math.abs(pane.clientWidth / canvas.clientWidth - 0.5) < 0.02
              );
            })
          );
        }),
      { timeout: 20000, timeoutMsg: "Image edge drop did not split the Linux canvas" },
    );
    assert.equal((await browser.$$("[data-session-canvas]")).length, 1);
  });
  // Leave the next native test at smoke's original state, with no terminal open.
  await browser.$('#cli-sidebar [data-terminal-shown="true"] .xterm-screen').click();
  await browser.performActions([
    {
      type: "key",
      id: "close-drop-terminal",
      actions: [
        { type: "keyDown", value: "\uE009" },
        { type: "keyDown", value: "x" },
        { type: "keyUp", value: "x" },
        { type: "keyUp", value: "\uE009" },
      ],
    },
  ]);
  await browser.$(".canvas-tab-close").click();
  await browser.$("[data-session-canvas]").waitForExist({ reverse: true });
  unlinkSync(path);
}
