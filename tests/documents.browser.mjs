import assert from "node:assert/strict";

/** Run against Vite with a Playwright page; the fixture also exercises StrictMode cleanup. */
export async function verifyDocuments(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/tests/fixtures/documents.html`);
  const pdf = page.getByRole("region", { name: "PDF", exact: true });
  const dxf = page.getByRole("region", { name: "DXF", exact: true });
  await pdf.getByRole("img", { name: "sample.pdf — 1" }).waitFor();
  await page.waitForFunction(() => !document.querySelector('[role="status"]'));
  assert.equal(
    await pdf.locator("canvas").evaluate((canvas) => {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((value, index) => index % 4 !== 3 && value < 100);
    }),
    true,
  );
  await pdf.getByRole("button", { name: "Next page" }).click();
  await pdf.getByRole("img", { name: "sample.pdf — 2" }).waitFor();
  assert.equal(await pdf.getByRole("button", { name: "Next page" }).isDisabled(), true);
  await page.waitForFunction(() => !document.querySelector('[role="status"]'));
  const width = await pdf.locator("canvas").evaluate((canvas) => canvas.style.width);
  await pdf.getByRole("button", { name: "Zoom in", exact: true }).click();
  await page.waitForFunction(
    (previous) =>
      document.querySelector(".file-preview__pdf-paper canvas").style.width !== previous,
    width,
  );
  await pdf.getByRole("button", { name: "Fit to width" }).click();
  await page.waitForFunction(
    (previous) =>
      document.querySelector(".file-preview__pdf-paper canvas").style.width === previous,
    width,
  );
  assert.equal(await dxf.locator("canvas").count(), 1);
  assert.equal(await dxf.getByRole("button", { name: "Fit to view" }).isEnabled(), true);
  const drawing = dxf.locator("canvas");
  const beforeZoom = await drawing.screenshot();
  await drawing.hover();
  await page.mouse.wheel(0, -200);
  const afterZoom = await drawing.screenshot();
  assert.equal(beforeZoom.equals(afterZoom), false, "DXF zoom changes the drawing");
  const box = await drawing.boundingBox();
  if (!box) throw new Error("Missing DXF canvas");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  assert.equal(afterZoom.equals(await drawing.screenshot()), false, "DXF pan changes the drawing");
  await dxf.getByRole("button", { name: "Fit to view" }).click();
  await dxf.evaluate((element) => {
    element.style.width = "420px";
  });
  await page.waitForFunction(
    () => document.querySelector(".file-preview__dxf canvas").style.width === "420px",
  );
  await page.getByRole("button", { name: "Toggle viewers" }).click();
  assert.equal(await page.locator("canvas").count(), 0);
  await page.getByRole("button", { name: "Toggle viewers" }).click();
  await page.waitForFunction(
    () =>
      document.querySelectorAll("canvas").length === 2 &&
      !document.querySelector('[role="status"]'),
  );
  await page.getByRole("button", { name: "Toggle broken" }).click();
  await pdf.getByRole("alert").waitFor();
  assert.equal(errors.length, 0, errors.join("\n"));
}
