import assert from "node:assert/strict";

/** Exercise the actual iframe sandbox, styles, and blocked network resources. */
export async function verifyHtmlPreview(page, base = "http://127.0.0.1:18422") {
  const requests = [];
  const collect = (route) => {
    requests.push(route.request().url());
    return route.abort();
  };
  await page.route("https://preview-test.invalid/**", collect);
  try {
    await page.goto(`${base}/tests/fixtures/html-preview.html`);
    const frame = page.frameLocator("iframe.html-reading");
    const heading = frame.getByRole("heading", { name: "Styled HTML 日本語" });
    await heading.waitFor();
    assert.equal(
      await heading.evaluate((element) => getComputedStyle(element).color),
      "rgb(20, 70, 130)",
    );
    assert.equal(
      await frame.locator(".layout").evaluate((element) => getComputedStyle(element).display),
      "grid",
    );
    assert.equal(await frame.locator("svg rect").count(), 1);
    assert.equal(await frame.locator("svg rect").getAttribute("fill"), "teal");
    assert.equal(await page.locator("iframe.html-reading").getAttribute("sandbox"), "");
    assert.equal(
      await frame.locator("script, form, iframe, base, link, [href], [onerror]").count(),
      0,
    );
    const pixel = frame.getByRole("img", { name: "Embedded pixel" });
    assert.equal(
      await pixel.evaluate((element) => element.complete && element.naturalWidth === 1),
      true,
    );
    await frame.getByText("Inert link", { exact: true }).click();
    await frame.getByRole("button", { name: "Submit" }).click();
    assert.equal(page.url(), `${base}/tests/fixtures/html-preview.html`);
    assert.equal(await page.locator("body").getAttribute("data-compromised"), null);
    assert.deepEqual(requests, []);
  } finally {
    await page.unroute("https://preview-test.invalid/**", collect);
  }
}
