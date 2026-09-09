import assert from "node:assert/strict";

/** Render every supported format and exercise controls, replacement, and cleanup. */
export async function verifyModels(page, base = "http://127.0.0.1:18424") {
  const errors = [];
  const collect = (error) => errors.push(error.message);
  page.on("pageerror", collect);
  try {
    await page.goto(`${base}/tests/fixtures/models.html`);
    const fit = page.getByRole("button", { name: "Fit to view", exact: true });
    await page.waitForFunction(
      () => document.querySelector("canvas") && !document.querySelector('[role="status"]'),
    );
    const canvas = page.locator("canvas");
    const initial = await canvas.screenshot();
    await canvas.hover();
    await page.mouse.wheel(0, -400);
    assert.equal(
      initial.equals(await canvas.screenshot()),
      false,
      "Zoom changes rendered geometry",
    );
    await fit.click();
    const box = await canvas.boundingBox();
    assert.ok(box);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2 + 20, { steps: 5 });
    await page.mouse.up();
    const rotated = await canvas.screenshot();
    assert.equal(initial.equals(rotated), false, "Orbit changes rendered geometry");
    await page.mouse.down({ button: "right" });
    await page.mouse.move(box.x + box.width / 2 + 150, box.y + box.height / 2 + 50, { steps: 5 });
    await page.mouse.up({ button: "right" });
    assert.equal(rotated.equals(await canvas.screenshot()), false, "Pan changes rendered geometry");
    for (const format of ["stl", "gltf", "glb", "local"]) {
      await page.getByLabel("Format").selectOption(format);
      await page.waitForFunction(
        () => document.querySelector("canvas") && !document.querySelector('[role="status"]'),
      );
      assert.equal(await page.getByRole("alert").count(), 0, format);
      assert.equal(await canvas.count(), 1, format);
      assert.equal(await fit.isEnabled(), true, format);
    }
    await page.getByRole("region", { name: "Model" }).evaluate((element) => {
      element.style.width = "420px";
    });
    await page.waitForFunction(() => document.querySelector("canvas")?.style.width === "420px");
    await page.getByRole("button", { name: "Toggle broken", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await canvas.count(), 0);
    await page.getByRole("button", { name: "Toggle broken", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("canvas"));
    await page.getByRole("button", { name: "Toggle viewer", exact: true }).click();
    assert.equal(await canvas.count(), 0);
    await page.getByRole("button", { name: "Toggle viewer", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("canvas"));
    await page.getByLabel("Format").selectOption("external");
    await page.getByRole("alert").waitFor();
    assert.equal(await canvas.count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    page.off("pageerror", collect);
  }
}
