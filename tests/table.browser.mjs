import assert from "node:assert/strict";

export async function verifyTable(page, base = "http://127.0.0.1:18423") {
  await page.goto(`${base}/tests/fixtures/table.html`);
  const rows = page.locator("tbody tr");
  await rows.first().waitFor();
  assert.equal(await rows.count(), 100);
  assert.deepEqual(await rows.first().locator("td").allTextContents(), [
    "ten, item",
    "10",
    "first\nsecond",
  ]);
  assert.equal(await page.locator("td b").count(), 0);
  const count = page.getByRole("button", { name: "Count" });
  await count.click();
  assert.equal(await rows.first().locator("td").nth(1).textContent(), "2");
  assert.equal(await page.locator('th[aria-sort="ascending"]').count(), 1);
  await count.click();
  assert.equal(await rows.first().locator("td").nth(1).textContent(), "204");
  await count.click();
  assert.equal(await rows.first().locator("td").nth(1).textContent(), "10");
  await page.getByRole("button", { name: "Next page" }).click();
  assert.equal(await rows.count(), 7);
  await page.getByRole("searchbox").fill("two");
  assert.equal(await rows.count(), 1);
  assert.deepEqual(await rows.first().locator("td").allTextContents(), ["two", "2", 'a "quote"']);
  await page.getByRole("searchbox").fill("");
  await page.getByRole("checkbox").uncheck();
  assert.equal(await page.getByRole("button", { name: "Column 1" }).count(), 1);
  assert.equal(await rows.first().locator("td").first().textContent(), "Name");
  await page.getByRole("searchbox").fill("no matching row");
  assert.equal(await rows.count(), 0);
  assert.equal(await page.getByText("No rows to display.").count(), 1);
}
