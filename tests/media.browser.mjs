import assert from "node:assert/strict";

/** Run against Vite with a Playwright page; StrictMode exercises effect cleanup. */
export async function verifyMedia(page, base = "http://127.0.0.1:18422") {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/tests/fixtures/media.html`);
  await page.waitForFunction(() => document.querySelector("audio")?.readyState >= 1);
  const audio = page.locator("audio");
  assert.deepEqual(
    await audio.evaluate((player) => ({
      controls: player.controls,
      autoplay: player.autoplay,
      paused: player.paused,
      duration: player.duration,
    })),
    { controls: true, autoplay: false, paused: true, duration: 2 },
  );
  assert.equal(
    await page
      .locator("video")
      .evaluate((player) => player.controls && player.playsInline && !player.autoplay),
    true,
  );
  await page.getByRole("region", { name: "Video", exact: true }).getByRole("alert").waitFor();
  await audio.evaluate(async (player) => {
    player.muted = true;
    await player.play();
  });
  assert.equal(await audio.evaluate((player) => player.paused), false);
  await page.getByRole("button", { name: "Toggle broken" }).click();
  const region = page.getByRole("region", { name: "Audio", exact: true });
  await region.getByRole("alert").waitFor();
  await page.getByRole("button", { name: "Toggle broken" }).click();
  await page.waitForFunction(() => document.querySelector("audio")?.readyState >= 1);
  assert.equal(await region.getByRole("alert").count(), 0);
  assert.equal(await audio.evaluate((player) => player.paused), true);
  const detached = await audio.elementHandle();
  await audio.evaluate(async (player) => {
    player.muted = true;
    await player.play();
  });
  await page.getByRole("button", { name: "Toggle viewers" }).click();
  assert.equal(
    await detached.evaluate((player) => player.paused && !player.hasAttribute("src")),
    true,
  );
  await detached.dispose();
  await page.getByRole("button", { name: "Toggle viewers" }).click();
  await page.waitForFunction(() => document.querySelector("audio")?.readyState >= 1);
  assert.equal(errors.length, 0, errors.join("\n"));
}
