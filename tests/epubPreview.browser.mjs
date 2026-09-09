import assert from "node:assert/strict";

export async function verifyEpubPreview(page, base = "http://127.0.0.1:18425") {
  const requests = [];
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("https://preview-test.invalid/**", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto(`${base}/tests/fixtures/epub-preview.html`);
  const frame = () => page.frameLocator(".epub-reading iframe").first();
  await frame().getByRole("heading", { name: "First chapter" }).waitFor();
  await page
    .getByRole("combobox")
    .locator("option", { hasText: "First chapter" })
    .waitFor({ state: "attached" });
  assert.equal(
    await frame()
      .getByRole("heading")
      .evaluate((e) => getComputedStyle(e).color),
    "rgb(20, 70, 130)",
  );
  const pixel = frame().getByRole("img", { name: "Book pixel" });
  await pixel.evaluate((e) => e.decode());
  assert.equal(await pixel.evaluate((e) => e.complete && e.naturalWidth === 1), true);
  assert.equal(await frame().locator("script,[onerror]").count(), 0);
  assert.equal(
    await page.locator(".epub-reading iframe").first().getAttribute("sandbox"),
    "allow-same-origin",
  );
  await frame().getByText("External link").click();
  assert.equal(page.url(), `${base}/tests/fixtures/epub-preview.html`);
  await frame().getByText("Other chapter").click();
  await frame().getByRole("heading", { name: "Second chapter" }).waitFor();
  assert.equal(await frame().locator("script,[onerror]").count(), 0);
  await page.getByRole("combobox").selectOption("one.xhtml");
  await frame().getByRole("heading", { name: "First chapter" }).waitFor();
  await page.getByRole("button", { name: "Next page" }).click();
  await frame().getByRole("heading", { name: "Second chapter" }).waitFor();
  await page.getByRole("button", { name: "Previous page" }).click();
  await frame().getByRole("heading", { name: "First chapter" }).waitFor();
  await page
    .locator("section")
    .first()
    .evaluate((e) => {
      e.style.width = "420px";
    });
  await page.getByRole("button", { name: "Invalid", exact: true }).click();
  await page.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "Valid", exact: true }).click();
  await frame().getByRole("heading", { name: "First chapter" }).waitFor();
  await page.getByRole("button", { name: "Toggle" }).click();
  await page.getByRole("button", { name: "Toggle" }).click();
  await frame().getByRole("heading", { name: "First chapter" }).waitFor();
  assert.equal(await page.locator("body").getAttribute("data-compromised"), null);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
}
