import { invoke } from "@tauri-apps/api/core";
import { remember } from "./remembered.ts";

/**
 * A host as the backend takes it: `user@address`, `user@address:port` or an alias from
 * ~/.ssh/config. A remote path is `ssh://<host>/<path>`, home being `ssh://<host>/~`.
 */
export interface SshTyped {
  host: string;
  /** On the host: `~`, `~/...` or `/...`. */
  path: string;
  url: string;
}

/** Options of ssh(1) that take the next word; `-p` and `-l` are read, the rest skipped. */
const WITH_ARGUMENT = new Set("BbcDEeFIiJLlmOopQRSWw");

/** What a host is spelled with: no spaces and no path separators. */
const HOST = /^[^\s/\\]+$/;

/** `ssh://<host>` at the front of a remote path. */
const REMOTE = /^ssh:\/\/([^\\/]+)/;

/**
 * `ssh a@ip`, `ssh -p 2222 a@ip ~/repo` and the like, read as the place they would land in; null
 * when the text is not an ssh command. A word after the destination is a path, not a command.
 */
export function parseSshTyped(text: string): SshTyped | null {
  const words = text.trim().split(/\s+/);
  if (words[0] !== "ssh") return null;
  let port: string | null = null;
  let user: string | null = null;
  let destination: string | null = null;
  let path: string | null = null;
  for (let index = 1; index < words.length; index++) {
    const word = words[index];
    if (word.startsWith("-") && word.length > 1) {
      const flag = word[1];
      if (!WITH_ARGUMENT.has(flag)) continue;
      // `-p2222` carries its argument; `-p 2222` takes the next word.
      const argument = word.length > 2 ? word.slice(2) : words[++index];
      if (argument === undefined) return null;
      if (flag === "p") port = argument;
      if (flag === "l") user = argument;
      continue;
    }
    if (destination === null) destination = word;
    else if (path === null) path = word;
    else return null;
  }
  if (destination === null) return null;
  // `ssh ssh://a@ip:2222` is a destination too.
  destination = destination.replace(/^ssh:\/\//, "").replace(/\/+$/, "");
  if (!HOST.test(destination)) return null;
  if (port !== null) {
    if (!/^\d+$/.test(port)) return null;
    destination = `${destination.replace(/:\d+$/, "")}:${port}`;
  }
  if (user !== null && !destination.includes("@")) destination = `${user}@${destination}`;
  return remoteAt(destination, path ?? "~");
}

/** `path` as ssh reads it: relative to home unless it starts at the root. */
function remoteAt(host: string, typed: string): SshTyped {
  const trimmed = typed.length > 1 ? typed.replace(/\/+$/, "") : typed;
  const path = trimmed.startsWith("/") || trimmed.startsWith("~") ? trimmed : `~/${trimmed}`;
  return { host, path, url: `ssh://${host}/${path.replace(/^\/+/, "")}` };
}

/** The host a remote path is on, or null for a path on this machine. */
export function sshHostOf(path: string): string | null {
  return path.match(REMOTE)?.[1] ?? null;
}

/** Home on `host`. */
export function sshHome(host: string): string {
  return `ssh://${host}/~`;
}

/** A host typed to be registered: `a@ip`, `a@ip:port`, an alias, or an ssh command. */
export function readSshHost(text: string): string | null {
  const typed = text.trim();
  const command = parseSshTyped(typed);
  if (command) return command.host;
  const bare = typed.replace(/^ssh:\/\//, "").replace(/\/.*$/, "");
  return bare && HOST.test(bare) ? bare : null;
}

const HOSTS_KEY = "totex.sshHosts";

export function sshHosts(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(HOSTS_KEY) ?? "[]");
    // Written by some earlier version: read as a claim, not a fact.
    if (Array.isArray(stored)) return stored.filter((host) => typeof host === "string");
  } catch {}
  return [];
}

/** Returns the hosts now registered. */
export function rememberSshHost(host: string): string[] {
  const held = sshHosts();
  if (held.includes(host)) return held;
  const kept = [...held, host];
  remember(HOSTS_KEY, kept);
  return kept;
}

/** Returns the hosts now registered. */
export function forgetSshHost(host: string): string[] {
  const kept = sshHosts().filter((held) => held !== host);
  remember(HOSTS_KEY, kept);
  return kept;
}

/** A password asked of the person; answered with the password, or null when cancelled. */
export interface PasswordAsk {
  host: string;
  /** The last password given for this host was refused. */
  wrong: boolean;
  answer: (password: string | null) => void;
}

// One at a time: a second host waits behind the first.
let asks: PasswordAsk[] = [];
const listeners = new Set<() => void>();

function told() {
  for (const listener of listeners) listener();
}

export function subscribePasswordAsks(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The ask on screen, or null. */
export function currentPasswordAsk(): PasswordAsk | null {
  return asks[0] ?? null;
}

function askPassword(host: string, wrong: boolean): Promise<string | null> {
  return new Promise((resolve) => {
    const ask: PasswordAsk = {
      host,
      wrong,
      answer: (password) => {
        asks = asks.filter((held) => held !== ask);
        told();
        resolve(password);
      },
    };
    asks = [...asks, ask];
    told();
  });
}

/** `ok`: open without asking; `given`: a password was taken; null: the person cancelled. */
export type Reach = "ok" | "given" | null;

const reaching = new Map<string, Promise<Reach>>();

/**
 * Asks for a password as long as the host wants one. Rejects with the backend's `ssh-host-key`
 * or `ssh-unreachable: <reason>`.
 */
export function reachSshWith(host: string): Promise<Reach> {
  const held = reaching.get(host);
  if (held) return held;
  const run = (async (): Promise<Reach> => {
    let answer = await invoke<string>("ssh_reach", { host });
    if (answer === "ok") return "ok";
    let wrong = false;
    while (answer !== "ok") {
      const password = await askPassword(host, wrong);
      if (password === null) return null;
      answer = await invoke<string>("ssh_password", { host, password });
      wrong = true;
    }
    return "given";
  })().finally(() => reaching.delete(host));
  reaching.set(host, run);
  return run;
}

/** False when the person cancelled the password. */
export async function reachSsh(host: string): Promise<boolean> {
  return (await reachSshWith(host)) !== null;
}

/** The `ssh` strings a failure is told with. */
export type SshFailureKey = "ssh.hostKey" | "ssh.unreachable" | "ssh.failed" | "ssh.notHost";

/** A failure as a message key and its values. */
export function sshFailure(error: unknown): { key: SshFailureKey; reason: string } {
  const text = String(error);
  if (text === "ssh-host-key") return { key: "ssh.hostKey", reason: "" };
  const unreachable = text.match(/^ssh-unreachable:\s*(.*)$/s);
  if (unreachable) return { key: "ssh.unreachable", reason: unreachable[1] };
  return { key: "ssh.failed", reason: text };
}
