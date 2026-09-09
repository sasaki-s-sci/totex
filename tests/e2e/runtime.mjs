import { spawn } from "node:child_process";
import { once } from "node:events";
import { closeSync, existsSync, openSync, readFileSync } from "node:fs";
import { createConnection, createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

export async function waitFor(check, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${description}`);
}

export async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

/** Each child owns a process group; cleanup also ends its WebView and shells. */
export function launch(command, args, log, env, extraStdio = []) {
  const fd = openSync(log, "w");
  const child = spawn(command, args, {
    env,
    detached: true,
    stdio: ["ignore", fd, fd, ...extraStdio],
  });
  closeSync(fd);
  child.failure = null;
  child.on("error", (error) => {
    child.failure = error;
  });
  return child;
}

export function checkRunning(child, name) {
  if (child.failure) throw child.failure;
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`${name} exited early (${child.exitCode ?? child.signalCode}); see its log`);
  }
}

export async function stop(child, signal = "SIGTERM") {
  if (!child?.pid) return;
  const kill = (sent) => {
    try {
      process.kill(-child.pid, sent);
    } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
  };
  kill(signal);
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null) break;
    await delay(100);
  }
  kill("SIGKILL");
}

/** The persistent service deliberately detaches from the app. Ask only this
 * run's service to close its PTYs before removing its private state. */
export async function stopPersistent(addressPath) {
  if (!existsSync(addressPath)) return;
  const { port, token } = JSON.parse(readFileSync(addressPath, "utf8"));
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(3000);
    socket.on("connect", () => {
      socket.write(`${JSON.stringify({ token })}\n${JSON.stringify({ id: 1, do: "stop" })}\n`);
    });
    // Drain the hello and response; the service closes the connection on exit.
    socket.on("data", () => {});
    socket.on("close", resolve);
    socket.on("error", (error) => {
      if (error.code !== "ECONNREFUSED") reject(error);
    });
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Persistent service did not stop"));
    });
  });
}
