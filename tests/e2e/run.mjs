import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { remote } from "webdriverio";
import { writeReport } from "./report.mjs";
import { checkRunning, freePort, launch, stop, stopPersistent, waitFor } from "./runtime.mjs";
import { smoke } from "./smoke.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const appWindow = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8")).app
  .windows[0];
const videoSize = `${appWindow.width}x${appWindow.height}`;
const output = join(root, "test-results", "e2e", new Date().toISOString().replaceAll(":", "-"));
mkdirSync(output, { recursive: true });
const temporary = mkdtempSync(join(tmpdir(), "totex-e2e-"));
const result = {
  started: new Date().toISOString(),
  commit: execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  status: "failed",
  video: false,
  steps: [],
};
let display;
let driver;
let recorder;
let browser;
let recordingStarted = 0;
const persistentAddress = join(temporary, "user/.local/share/com.totex.app/keep/address.json");

// Signals become ordinary failures so the MP4 is finalized and the report survives.
const controller = new AbortController();
controller.signal.addEventListener("abort", () => {
  // Interrupt pending WebDriver requests, then let run() unwind before cleanup.
  // Racing it against a rejected promise would leave run() creating children
  // after cleanup had already removed their temporary directories.
  for (const child of [driver, display]) {
    if (!child?.pid) continue;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      /* Already stopped. */
    }
  }
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => controller.abort(new Error(`Interrupted by ${signal}`)));
}
const watchdog = setTimeout(() => controller.abort(new Error("E2E exceeded 180 seconds")), 180000);

async function step(name, action) {
  controller.signal.throwIfAborted();
  checkRunning(recorder, "FFmpeg");
  const record = { name, status: "failed", videoSeconds: (Date.now() - recordingStarted) / 1000 };
  result.steps.push(record);
  console.log(`E2E: ${name}`);
  try {
    await action();
    // Leave each verified state on screen long enough to review in the video.
    await delay(500);
    record.status = "passed";
  } catch (error) {
    record.error = error.stack ?? String(error);
    throw error;
  } finally {
    try {
      const name = `step-${result.steps.length}.png`;
      await browser.saveScreenshot(join(output, name));
      record.screenshot = name;
    } catch {
      // The original test failure is more useful if the WebView has crashed.
    }
  }
}

async function run() {
  if (process.platform !== "linux") throw new Error("Video E2E currently requires Linux.");
  for (const tool of ["Xvfb", "ffmpeg", "ffprobe", "WebKitWebDriver", "tauri-driver"]) {
    execFileSync("which", [tool], { stdio: "pipe" });
  }
  const binary = join(root, "src-tauri/target/debug/totex");
  const sidecar = join(root, "src-tauri/target/debug/totex-persistent");
  if (!existsSync(binary) || !existsSync(sidecar)) {
    throw new Error("Build first with task test:e2e (or task test:e2e:build).");
  }

  const repository = join(temporary, "demo-repo");
  mkdirSync(repository);
  const git = (...args) => execFileSync("git", ["-C", repository, ...args], { stdio: "pipe" });
  git("init", "--initial-branch=main");
  git("config", "user.name", "totex E2E");
  git("config", "user.email", "e2e@example.invalid");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(repository, "README.md"), "# E2E demo repository\n");
  git("add", ".");
  git("commit", "-m", "Initial E2E commit");

  const privateHome = join(temporary, "user");
  const runtime = join(temporary, "runtime");
  mkdirSync(join(privateHome, ".totex"), { recursive: true });
  mkdirSync(runtime, { mode: 0o700 });
  writeFileSync(
    join(privateHome, ".totex", "totex.json"),
    JSON.stringify({ language: "en", theme: "light", follow: false, mcpServing: false }),
  );
  // Only app/driver children receive this private user environment. The developer's
  // environment and build toolchain remain untouched; no existing sessions are reused.
  const env = {
    ...process.env,
    HOME: privateHome,
    XDG_CONFIG_HOME: join(privateHome, ".config"),
    XDG_DATA_HOME: join(privateHome, ".local/share"),
    XDG_CACHE_HOME: join(privateHome, ".cache"),
    XDG_RUNTIME_DIR: runtime,
    GDK_BACKEND: "x11",
    LIBGL_ALWAYS_SOFTWARE: "1",
    TOTEX_BUILT_IN_FRONT: "1",
    TOTEX_PERSISTENT: sidecar,
    SHELL: "/bin/sh",
    LANG: "C.UTF-8",
    LC_ALL: "C.UTF-8",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
  delete env.DBUS_SESSION_BUS_ADDRESS;
  delete env.WAYLAND_DISPLAY;
  delete env.TOTEX_MCP_URL;
  delete env.TOTEX_MCP_TOKEN;

  display = launch(
    "Xvfb",
    // Linux clients can use abstract sockets without a shared /tmp/.X11-unix.
    ["-displayfd", "3", "-screen", "0", `${videoSize}x24`, "-nolisten", "tcp", "-nolisten", "unix"],
    join(output, "display.log"),
    env,
    ["pipe"],
  );
  let displayNumber = "";
  display.stdio[3].on("data", (data) => {
    displayNumber += data.toString();
  });
  await waitFor(() => {
    controller.signal.throwIfAborted();
    checkRunning(display, "Xvfb");
    return /^\d+\n$/.test(displayNumber);
  }, "virtual display startup");
  env.DISPLAY = `:${displayNumber.trim()}`;

  recorder = launch(
    "ffmpeg",
    [
      "-y",
      "-f",
      "x11grab",
      "-video_size",
      videoSize,
      "-framerate",
      "20",
      "-i",
      env.DISPLAY,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      join(output, "recording.mp4"),
    ],
    join(output, "recorder.log"),
    env,
  );
  recordingStarted = Date.now();
  await waitFor(() => {
    controller.signal.throwIfAborted();
    checkRunning(recorder, "FFmpeg");
    return readFileSync(join(output, "recorder.log"), "utf8").includes("Output #0");
  }, "video recorder startup");

  const port = await freePort();
  const nativePort = await freePort();
  controller.signal.throwIfAborted();
  driver = launch(
    "tauri-driver",
    ["--port", String(port), "--native-port", String(nativePort)],
    join(output, "driver.log"),
    env,
  );
  await waitFor(async () => {
    controller.signal.throwIfAborted();
    checkRunning(driver, "tauri-driver");
    try {
      return (await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1000) }))
        .ok;
    } catch {
      return false;
    }
  }, "WebDriver startup");
  browser = await remote({
    hostname: "127.0.0.1",
    port,
    logLevel: "warn",
    connectionRetryCount: 0,
    connectionRetryTimeout: 20000,
    waitforTimeout: 20000,
    capabilities: { "tauri:options": { application: binary } },
  });
  await smoke(browser, repository, step);
  checkRunning(recorder, "FFmpeg");
}

try {
  await run();
  controller.signal.throwIfAborted();
  result.status = "passed";
} catch (error) {
  const cause = controller.signal.reason ?? error;
  result.error = cause.stack ?? String(cause);
  console.error(result.error);
} finally {
  clearTimeout(watchdog);
  if (browser && !controller.signal.aborted) {
    try {
      writeFileSync(join(output, "page.html"), await browser.getPageSource());
      await browser.deleteSession();
    } catch (error) {
      result.cleanupError = String(error);
      result.status = "failed";
    }
  }
  try {
    await stopPersistent(persistentAddress);
  } catch (error) {
    result.cleanupError = String(error);
    result.status = "failed";
  }
  await stop(recorder, "SIGINT");
  await stop(driver);
  await stop(display);
  try {
    const duration = Number(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-of",
          "default=noprint_wrappers=1:nokey=1",
          join(output, "recording.mp4"),
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
    result.video = duration > 0;
    if (result.video) result.videoDuration = duration;
    else {
      result.status = "failed";
      result.recordingError = "Recording has no video duration";
    }
  } catch (error) {
    result.status = "failed";
    result.recordingError = String(error);
  }
  rmSync(temporary, { recursive: true, force: true });
  writeReport(output, result);
  console.log(`E2E ${result.status}: ${join(output, "index.html")}`);
  process.exitCode = result.status === "passed" ? 0 : 1;
}
