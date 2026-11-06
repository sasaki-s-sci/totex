import assert from "node:assert/strict";

/** Uses the real file fixture with native HTML5 dragging unavailable, as in Tauri on Windows. */
export async function verifyFileDragging(page, base) {
  await page.addInitScript(() => {
    document.addEventListener("dragstart", (event) => event.preventDefault(), true);
  });
  const row = (name) => page.locator(`[data-pick-row="/files/${name}"]`);
  const reset = async (query = "") => {
    await page.goto(`${base}/tests/fixtures/files.html${query}`);
    await row("alpha.txt").waitFor();
  };
  const transfers = () =>
    page.evaluate(() =>
      window.fsCalls.filter(({ cmd }) => cmd === "fs_copy_into" || cmd === "fs_move_into"),
    );
  const start = async () => {
    const from = await row("alpha.txt").boundingBox();
    const to = await row("other").boundingBox();
    await page.mouse.move(from.x + 50, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + 50, to.y + to.height / 2, { steps: 8 });
  };

  await reset();
  await row("alpha.txt").dragTo(row("other"));
  assert.deepEqual(
    (await transfers()).map(({ args }) => args),
    [{ paths: ["/files/alpha.txt"], into: "/files/other" }],
  );
  assert.equal(await row("other").getAttribute("aria-pressed"), "false");

  await reset();
  await row("folder.dir").dragTo(row("other"));
  assert.deepEqual(
    (await transfers()).map(({ args }) => args),
    [{ paths: ["/files/folder.dir"], into: "/files/other" }],
  );
  assert.equal(await row("folder.dir/child.txt").count(), 0, "A drag never expands the source");

  for (const cancel of ["escape", "pointercancel", "blur"]) {
    await reset();
    await start();
    if (cancel === "escape") await page.keyboard.press("Escape");
    else if (cancel === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    else await row("alpha.txt").dispatchEvent("pointercancel", { pointerId: 1, isPrimary: true });
    await page.mouse.up();
    assert.deepEqual(await transfers(), [], `${cancel} cancels without transferring`);
    await page.waitForFunction(
      () =>
        getComputedStyle(document.querySelector('[data-pick-row="/files/other"]')).outlineStyle ===
        "none",
    );
    await row("beta.txt").click();
    assert.equal(await row("beta.txt").getAttribute("aria-pressed"), "true");
  }

  await reset();
  await start();
  await page.mouse.move(600, 600);
  await page.mouse.up();
  assert.deepEqual(await transfers(), [], "Releasing outside a drop target does nothing");

  await reset();
  const from = await row("folder.dir").boundingBox();
  await page.mouse.move(from.x + 50, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 52, from.y + from.height / 2);
  await page.mouse.up();
  await row("folder.dir/child.txt").waitFor();
  assert.deepEqual(await transfers(), [], "A small pointer movement remains a click");
  await row("folder.dir/child.txt").click({ modifiers: ["Control"] });
  await row("alpha.txt").click({ modifiers: ["Control"] });
  await row("folder.dir/child.txt").dragTo(row("other"));
  assert.deepEqual(
    (await transfers()).map(({ args }) => args),
    [{ paths: ["/files/folder.dir", "/files/alpha.txt"], into: "/files/other" }],
    "Dragging a selected child carries the selection without repeating descendants",
  );

  await reset("?many");
  await start();
  const column = page.locator("[data-folder-pane]").first().locator("..");
  const box = await column.boundingBox();
  await page.mouse.move(box.x + 50, box.y + box.height - 8);
  await page.waitForFunction(
    () => document.querySelector("[data-folder-pane]").parentElement.scrollTop > 100,
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.deepEqual(await transfers(), [], "Scrolling during a drag does not transfer early");

  await reset();
  const destination = await row("other").boundingBox();
  const position = { x: (destination.x + 50) * 2, y: (destination.y + 10) * 2 };
  await page.evaluate((position) => {
    window.fsEmit("tauri://drag-enter", { paths: ["/outside/file.txt"], position });
  }, position);
  await page.waitForFunction(
    () =>
      getComputedStyle(document.querySelector('[data-pick-row="/files/other"]')).outlineStyle ===
      "solid",
  );
  await page.evaluate((position) => {
    window.fsEmit("tauri://drag-drop", { paths: ["/outside/file.txt"], position });
  }, position);
  assert.deepEqual(
    (await transfers()).map(({ cmd, args }) => [cmd, args]),
    [["fs_copy_into", { paths: ["/outside/file.txt"], into: "/files/other" }]],
    "External native drops still copy, with physical coordinates scaled to the window",
  );

  for (const ending of ["drop", "leave", "scale-error"]) {
    await reset();
    const target = await row("other").boundingBox();
    await page.evaluate(
      ({ target, ending }) => {
        const invoke = window.__TAURI_INTERNALS__.invoke;
        window.__TAURI_INTERNALS__.invoke = (cmd, args) => {
          if (cmd !== "plugin:window|scale_factor") return invoke(cmd, args);
          return new Promise((resolve, reject) => {
            window.finishScale = () =>
              ending === "scale-error" ? reject(new Error("scale unavailable")) : resolve(2);
          });
        };
        const payload = {
          paths: ["/outside/file.txt"],
          position: { x: (target.x + 50) * 2, y: (target.y + 10) * 2 },
        };
        window.fsEmit("tauri://drag-enter", payload);
        window.fsEmit(`tauri://drag-${ending === "leave" ? "leave" : "drop"}`, payload);
      },
      { target, ending },
    );
    assert.deepEqual(await transfers(), [], "A native drop must wait for its scale factor");
    await page.evaluate(() => window.finishScale());
    if (ending === "drop") {
      await page.waitForFunction(() => window.fsCalls.some(({ cmd }) => cmd === "fs_copy_into"));
      assert.deepEqual(
        (await transfers()).map(({ args }) => args),
        [{ paths: ["/outside/file.txt"], into: "/files/other" }],
      );
    } else {
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.deepEqual(await transfers(), []);
      assert.equal(
        await row("other").evaluate((node) => getComputedStyle(node).outlineStyle),
        "none",
        "A finished or failed drag must not leave a late highlight",
      );
    }
  }
}
