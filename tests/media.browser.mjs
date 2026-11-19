import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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
  const region = page.getByRole("region", { name: "Audio", exact: true });
  const changes = () => page.getByTestId("changes").textContent().then(JSON.parse);
  const position = region.getByRole("spinbutton", { name: "Position (s)" });
  const start = region.getByRole("spinbutton", { name: "Start (s)" });
  const end = region.getByRole("spinbutton", { name: "End (s)" });
  const apply = region.getByRole("button", { name: "Apply", exact: true });
  await region.locator("summary").click();
  await position.fill("0.5");
  await start.fill("0.4");
  await end.fill("0.9");
  await apply.click();
  assert.deepEqual(await changes(), [{ start: 0.4, end: 0.9, position: 0.5 }]);
  assert.equal(await audio.evaluate((player) => player.currentTime), 0.5);
  await end.fill("0.3");
  await apply.click();
  await region.getByRole("alert").waitFor();
  assert.equal((await changes()).length, 1);
  await end.fill("0.9");
  await position.fill("0.2");
  await apply.click();
  assert.equal((await changes()).length, 1);
  await position.fill("0.5");
  await apply.click();
  assert.equal(await region.getByRole("alert").count(), 0);
  await audio.evaluate((player) => {
    player.currentTime = 0.1;
  });
  await page.waitForFunction(() => document.querySelector("audio").currentTime === 0.4);
  await audio.evaluate(async (player) => {
    player.muted = true;
    await player.play();
  });
  assert.equal(await audio.evaluate((player) => player.paused), false);
  await page.waitForFunction(() => {
    const player = document.querySelector("audio");
    return player.paused && player.currentTime === 0.9;
  });
  assert.equal((await changes()).length, 2, "Native seeking and playback do not write state");
  await audio.evaluate(async (player) => {
    await player.play();
  });
  assert.equal(
    await audio.evaluate(
      (player) => !player.paused && player.currentTime >= 0.4 && player.currentTime < 0.7,
    ),
    true,
    "Play at the range end restarts at the range start",
  );
  await audio.evaluate((player) => player.pause());
  await page.evaluate(() => window.setMediaPlayback({ start: 0.4, end: 1.5, position: 0.8 }));
  await page.waitForFunction(() => document.querySelector("audio").currentTime === 0.8);
  assert.equal(
    await audio.evaluate((player) => player.paused),
    true,
    "A seek request does not autoplay",
  );
  await page.evaluate(() =>
    window.setMediaPlayback({ start: 0.4, end: 1.5, position: 0.8, playing: true }),
  );
  await page.waitForFunction(() => !document.querySelector("audio").paused);
  await page.getByRole("button", { name: "Toggle active" }).click();
  assert.equal(await audio.evaluate((player) => player.paused), true);
  const pausedAt = await audio.evaluate((player) => player.currentTime);
  await page.getByRole("button", { name: "Toggle active" }).click();
  assert.equal(
    await audio.evaluate(
      (player, expected) => player.paused && player.currentTime === expected,
      pausedAt,
    ),
    true,
  );
  await page.evaluate(() =>
    window.setMediaPlayback({ start: 0.4, end: 1.5, position: 1.5, playing: true }),
  );
  await page.waitForFunction(() => {
    const player = document.querySelector("audio");
    return !player.paused && player.currentTime >= 0.4 && player.currentTime < 0.8;
  });
  await page.evaluate(() =>
    window.setMediaPlayback({ start: 0.4, end: 1.5, position: 0.8, playing: false }),
  );
  await page.waitForFunction(() => document.querySelector("audio").paused);
  await audio.evaluate((player) => {
    player.currentTime = 1.1;
  });
  await page.evaluate(() =>
    window.setMediaPlayback({ start: 0.4, end: 1.5, position: 0.8, playing: false }),
  );
  assert.equal(
    await audio.evaluate((player) => player.currentTime),
    1.1,
    "An unchanged playback value from another pane revision does not reset the native timeline",
  );
  await page.evaluate(() =>
    window.setMediaPlayback({ start: 0.4, end: 1.5, position: 0.8, playing: true }),
  );
  await page.waitForFunction(() => !document.querySelector("audio").paused);
  assert.ok(
    await audio.evaluate((player) => player.currentTime >= 1.1),
    "Play-only changes resume",
  );
  await page.evaluate(() =>
    window.setMediaPlayback({ start: 0.4, end: 1.5, position: 0.8, playing: false }),
  );
  await page.waitForFunction(() => document.querySelector("audio").paused);
  assert.ok(
    await audio.evaluate((player) => player.currentTime >= 1.1),
    "Pause-only changes retain time",
  );
  await audio.evaluate((player) => {
    player.play = () => Promise.reject(new DOMException("Blocked", "NotAllowedError"));
  });
  await page.evaluate(() =>
    window.setMediaPlayback({ start: 0.4, end: 1.5, position: 0.8, playing: true }),
  );
  await region.getByRole("alert").filter({ hasText: "Play button" }).waitFor();
  await audio.evaluate((player) => {
    delete player.play;
  });
  await page.evaluate(() => window.setMediaPlayback({}));
  await page.getByRole("button", { name: "Toggle broken" }).click();
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
  await audio.evaluate((player) => {
    player.play = () =>
      new Promise((_, reject) => {
        window.rejectMediaPlay = reject;
      });
  });
  await page.evaluate(() => window.setMediaPlayback({ playing: true }));
  await page.waitForFunction(() => typeof window.rejectMediaPlay === "function");
  await page.getByRole("button", { name: "Toggle viewers" }).click();
  await page.evaluate(() => window.rejectMediaPlay(new DOMException("Removed", "AbortError")));
  await page.goto(`${base}/tests/fixtures/media.html?range`);
  await page.waitForFunction(() => document.querySelector("audio")?.readyState >= 1);
  assert.deepEqual(
    await audio.evaluate((player) => ({ position: player.currentTime, paused: player.paused })),
    { position: 2, paused: true },
    "Initial playback requests are clamped after metadata without autoplay",
  );
  const videoBytes = await readFile(new URL("./fixtures/canvas-video.webm", import.meta.url));
  await page.route("**/media-no-range.webm", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "video/webm", "Content-Length": String(videoBytes.length) },
      body: videoBytes,
    }),
  );
  await page.addInitScript(() => {
    window.mediaSeeks = 0;
    document.addEventListener(
      "seeking",
      () => {
        window.mediaSeeks += 1;
      },
      true,
    );
  });
  await page.goto(`${base}/tests/fixtures/media.html?nonseekable`);
  await page.waitForFunction(() => document.querySelector("video")?.readyState === 4);
  const video = page.locator("video");
  await page
    .getByRole("region", { name: "Video", exact: true })
    .getByRole("alert")
    .filter({ hasText: "cannot seek" })
    .waitFor();
  assert.deepEqual(
    await video.evaluate((player) => ({
      paused: player.paused,
      position: player.currentTime,
      seeking: player.seeking,
      seekableEnd: player.seekable.end(0),
    })),
    { paused: true, position: 0, seeking: false, seekableEnd: 0 },
    "A server that ignores byte ranges loads without a seek loop",
  );
  assert.ok(await page.evaluate(() => window.mediaSeeks <= 2), "Unsupported seeks are not retried");
  await page.evaluate(() => window.setMediaPlayback({}));
  await video.evaluate(async (player) => {
    player.muted = true;
    await player.play();
  });
  await page.waitForFunction(() => document.querySelector("video").currentTime > 0.1);
  assert.equal(
    await page.getByRole("region", { name: "Video", exact: true }).getByRole("alert").count(),
    0,
    "Clearing the range restores ordinary playback",
  );
  await page.evaluate(async () => {
    const { default: React } = await import("/node_modules/.vite/deps/react.js");
    const { default: ReactDOM } = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { MediaReading } = await import("/src/canvas/nodes/preview/MediaReading.tsx");
    const source = document.querySelector("audio").src;
    const host = document.createElement("div");
    host.dataset.mediaPopup = "true";
    host.style.cssText = "width:250px;height:200px;overflow:hidden";
    document.body.append(host);
    const root = ReactDOM.createRoot(host, { identifierPrefix: "media-popup-" });
    window.mediaPopup = { closed: 0, changes: [] };
    const render = (rangeAnchor) =>
      root.render(
        React.createElement(MediaReading, {
          source,
          name: "Bare sample.wav",
          kind: "audio",
          rangeAnchor,
          onPlaybackChange: (next) => window.mediaPopup.changes.push(next),
          onCloseRange: () => {
            window.mediaPopup.closed += 1;
            render(null);
          },
        }),
      );
    window.showMediaRange = render;
    render(null);
  });
  const bare = page.locator("[data-media-popup]");
  await page.waitForFunction(
    () => document.querySelector("[data-media-popup] audio")?.readyState >= 1,
  );
  assert.equal(await bare.locator("summary, .file-preview__media-name, form").count(), 0);
  assert.equal(await bare.locator("audio").evaluate((player) => player.controls), true);
  await page.evaluate(() => {
    window.mediaPopup.player = document.querySelector("[data-media-popup] audio");
    window.showMediaRange({ left: 247, top: 170 });
  });
  const popup = page.getByRole("dialog", { name: "Playback range", exact: true });
  await popup.getByRole("spinbutton", { name: "Start (s)" }).fill("0.4");
  await popup.getByRole("spinbutton", { name: "End (s)" }).fill("0.9");
  await popup.getByRole("button", { name: "Apply", exact: true }).click();
  await popup.getByRole("alert").waitFor();
  assert.equal(await page.evaluate(() => window.mediaPopup.closed), 0);
  await popup.getByRole("spinbutton", { name: "Position (s)" }).fill("0.5");
  await popup.getByRole("button", { name: "Apply", exact: true }).click();
  await popup.waitFor({ state: "hidden" });
  assert.deepEqual(await page.evaluate(() => window.mediaPopup.changes), [
    { start: 0.4, end: 0.9, position: 0.5 },
  ]);
  assert.equal(
    await bare
      .locator("audio")
      .evaluate((player) => player === window.mediaPopup.player && player.currentTime === 0.5),
    true,
    "Applying the popup retains the native player and playback position",
  );
  await bare.locator("audio").evaluate((player) => {
    player.currentTime = 0.7;
  });
  await page.evaluate(() => window.showMediaRange({ left: 247, top: 170 }));
  assert.equal(await popup.getByRole("spinbutton", { name: "Position (s)" }).inputValue(), "0.7");
  await page.keyboard.press("Escape");
  await popup.waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => window.mediaPopup.closed), 2);
  assert.equal(errors.length, 0, errors.join("\n"));
}
