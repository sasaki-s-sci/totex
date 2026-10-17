import { invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import { settingsNow } from "../lib/appSettings";
import { type Doing, doingNow, onDoing } from "../lib/doing";
import { notifications } from "../lib/notifications";
import { onShellExit, runningShells, startShell, writeShell } from "../lib/pty";
import { type Session, shellSession } from "../lib/session";
import {
  agentOf,
  type Doubt,
  type Job,
  KEPT,
  launchLine,
  parsePolicy,
  policyOf,
  readJobs,
  resumeLine,
  verdict,
  type Why,
} from "./model";

/**
 * The jobs totex started and has not seen end, kept in the service's store as they change. The store
 * is on disk and outlives both this window and a replaced service, which is the whole point: the
 * front that reads them back is the one after whatever lost them.
 */
const jobs = new Map<string, Job>();
/** Lost jobs offered rather than run, and why each was not simply run. */
const offers = new Map<string, Doubt[]>();
const changed = notifications();
let version = 0;
let listed: readonly Job[] = [];

function touched(): void {
  version += 1;
  listed = [...jobs.values()];
  changed.notify();
  keepSoon();
}

const KEEP_AFTER_MS = 300;
let soon: ReturnType<typeof setTimeout> | undefined;
let keeping = false;
let kept: string | null = null;

function keepSoon(): void {
  if (!keeping || soon !== undefined) return;
  soon = setTimeout(() => {
    soon = undefined;
    void keep();
  }, KEEP_AFTER_MS);
}

async function keep(): Promise<void> {
  clearTimeout(soon);
  soon = undefined;
  const value = { jobs: [...jobs.values()] };
  const json = JSON.stringify(value);
  if (json === kept) return;
  kept = json;
  await invoke("persistent_put", { name: KEPT, value }).catch(() => {
    if (kept === json) kept = null;
  });
}

export function useResumeJobs(): readonly Job[] {
  return useSyncExternalStore(changed.subscribe, () => listed);
}

export function useOffer(id: string): { job: Job; doubts: Doubt[] } | null {
  useSyncExternalStore(changed.subscribe, () => version);
  const job = jobs.get(id);
  const doubts = offers.get(id);
  return job && doubts ? { job, doubts } : null;
}

/** A guard asked, with how its answer reads to `verdict`. */
async function fingerprint(job: Job): Promise<string | null | "missing" | "failed"> {
  if (job.policy.guard === "none") return null;
  try {
    return await invoke<string | null>("resume_fingerprint", {
      cwd: job.cwd,
      guard: job.policy.guard,
    });
  } catch (cause) {
    return String(cause).includes("missing-directory") ? "missing" : "failed";
  }
}

async function refresh(job: Job): Promise<void> {
  const now = await fingerprint(job);
  const held = jobs.get(job.id);
  if (held !== job || held.lost) return;
  if (now !== "missing" && now !== "failed") {
    held.fingerprint = now;
    touched();
  }
}

/**
 * The line to type to start `line` in `session`, which is a fresh terminal, and the job it starts
 * where it is one: an agent, or a line with a `# resume:` spec. Anything else is typed as it is and
 * forgotten.
 */
export function launchJob(session: Session, line: string, spec: string | null): string {
  const settings = settingsNow().resume;
  const agent = agentOf(line);
  if (!agent && spec === null) return line;
  const policy = spec === null ? policyOf(settings) : parsePolicy(spec, policyOf(settings));
  const launch = launchLine(line, () => crypto.randomUUID());
  const at = Date.now();
  const job: Job = {
    id: session.id,
    cwd: session.cwd,
    branch: session.branch,
    ...(session.folder ? { folder: true } : null),
    line: launch.line,
    agent,
    session: launch.session,
    policy,
    startedAt: at,
    seenAt: at,
    running: false,
    working: false,
    fingerprint: null,
    lost: null,
  };
  jobs.set(job.id, job);
  touched();
  void refresh(job);
  return launch.line;
}

function lose(id: string, why: Why): void {
  const job = jobs.get(id);
  if (!job || job.lost || !job.running) return;
  job.lost = { why, at: Date.now() };
  touched();
}

/** Called as a terminal is closed from the window, before its shell is ended. */
export function closing(id: string): void {
  lose(id, "close");
  offers.delete(id);
}

/**
 * Called before a program update ends this process, and with it, on a minor update, every
 * terminal. Each job is marked lost to the update, with the world it was running in as it stands
 * now rather than as of the last look, so the next front compares like with like.
 */
export async function holdForRestart(): Promise<void> {
  const alive = [...jobs.values()].filter((job) => !job.lost && job.running);
  await Promise.race([
    Promise.all(alive.map((job) => refresh(job))),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
  const at = Date.now();
  for (const job of alive) {
    job.seenAt = at;
    job.lost = { why: "update", at };
  }
  touched();
  await keep();
}

export function dismiss(id: string): void {
  jobs.delete(id);
  offers.delete(id);
  touched();
}

type Opener = {
  /** Puts a terminal back without showing it. */
  restore: (session: Session) => void;
  /** Opens one and shows it. */
  open: (session: Session) => void;
};
let opener: Opener | null = null;

/**
 * Takes a lost job up again. Into its own terminal where that is open again — an offer drawn over
 * it — and otherwise into a new one in the same directory, shown.
 */
export function resumeJob(id: string, open: readonly string[]): void {
  const job = jobs.get(id);
  if (!job) return;
  const prompt = job.agent && job.working ? settingsNow().resume.prompt : null;
  const line = resumeLine(job, prompt);
  let into = job.id;
  if (!open.includes(job.id)) {
    const session = shellSession(job.cwd, job.branch, job.folder);
    opener?.open(session);
    into = session.id;
  }
  jobs.delete(job.id);
  offers.delete(job.id);
  const at = Date.now();
  jobs.set(into, {
    ...job,
    id: into,
    startedAt: at,
    seenAt: at,
    running: false,
    working: false,
    lost: null,
  });
  touched();
  void startShell({ id: into, cwd: job.cwd, branch: job.branch, folder: job.folder })
    .then(() => writeShell(into, `${line}\n`))
    .catch(() => undefined);
}

/**
 * What the last front left, read once per launch, against the terminals still running: a job whose
 * terminal is running was not lost after all (a patch update keeps them), and every other one is
 * judged by its policy.
 */
let restoring = false;

async function restore(): Promise<void> {
  let stored: unknown;
  try {
    stored = await invoke<unknown>("persistent_get", { name: KEPT });
  } catch {
    // A store that will not answer is never written either, so what it holds is not replaced.
    return;
  }
  const running = new Set((await runningShells().catch(() => [])).map((shell) => shell.id));
  for (const job of readJobs(stored)) if (!jobs.has(job.id)) jobs.set(job.id, job);
  keeping = true;
  const at = Date.now();
  for (const job of [...jobs.values()]) {
    if (running.has(job.id)) {
      if (job.lost?.why === "close") jobs.delete(job.id);
      else job.lost = null;
      continue;
    }
    if (!job.running) {
      jobs.delete(job.id);
      continue;
    }
    // Lost without a word: nothing marked it on the way out, so whatever happened was not asked for.
    if (!job.lost) job.lost = { why: "crash", at };
    const judged = verdict(job, at, await fingerprint(job));
    if (judged.act === "drop") {
      jobs.delete(job.id);
      continue;
    }
    if (job.lost.why === "close") {
      offers.set(job.id, judged.doubts);
      continue;
    }
    // Its terminal comes back either way, under the same name, where the graph left room for it.
    opener?.restore({ id: job.id, cwd: job.cwd, branch: job.branch, folder: job.folder });
    if (judged.act === "auto") resumeJob(job.id, [job.id]);
    else offers.set(job.id, judged.doubts);
  }
  touched();
}

/** How long a job has to sit at a prompt to have ended, rather than to have drawn one. */
const ENDED_AFTER_MS = 3000;
/** A job never seen running by then never started, or ended before it could be seen. */
const NEVER_RAN_MS = 60_000;
const LOOK_EVERY_MS = 15_000;
const GUARD_EVERY_MS = 60_000;

const doings = new Map<string, Doing>();
const ending = new Map<string, ReturnType<typeof setTimeout>>();

function saw(id: string, doing: Doing): void {
  doings.set(id, doing);
  const job = jobs.get(id);
  if (!job || job.lost) return;
  clearTimeout(ending.get(id));
  ending.delete(id);
  if (doing !== "idle") {
    job.running = true;
    job.working = doing === "working";
    job.seenAt = Date.now();
    touched();
    return;
  }
  if (!job.running) return;
  ending.set(
    id,
    setTimeout(() => {
      ending.delete(id);
      if (doings.get(id) === "idle" && jobs.get(id) === job && !job.lost) dismiss(id);
    }, ENDED_AFTER_MS),
  );
}

async function claimCodex(job: Job): Promise<void> {
  const found = await invoke<string[]>("resume_codex_sessions", {
    cwd: job.cwd,
    sinceMs: job.startedAt,
  }).catch(() => []);
  const claimed = new Set([...jobs.values()].map((other) => other.session));
  const session = found.find((id) => !claimed.has(id));
  if (session && jobs.get(job.id) === job && job.session === null) {
    job.session = session;
    touched();
  }
}

let guardedAt = 0;

function look(): void {
  const at = Date.now();
  const guarding = at - guardedAt >= GUARD_EVERY_MS;
  if (guarding) guardedAt = at;
  for (const job of [...jobs.values()]) {
    if (job.lost) {
      if (offers.has(job.id) && job.lost.why === "close" && verdict(job, at, null).act === "drop")
        dismiss(job.id);
      continue;
    }
    const doing = doings.get(job.id);
    if (!job.running) {
      if (at - job.startedAt > NEVER_RAN_MS && doing === "idle") dismiss(job.id);
      continue;
    }
    if (doing && doing !== "idle") job.seenAt = at;
    if (guarding) void refresh(job);
    if (job.agent === "codex" && job.session === null) void claimCodex(job);
  }
  touched();
}

/**
 * Runs the jobs for the main window: reads back what was lost, follows what runs, and marks what a
 * shell ending under it took.
 */
export function useResumeRuntime(sessions: Opener): void {
  opener = sessions;
  useEffect(() => {
    let alive = true;
    const stops: Promise<() => void>[] = [
      onDoing(({ id, doing }) => saw(id, doing)),
      onShellExit((id) => lose(id, "crash")),
    ];
    void doingNow()
      .then((all) => {
        if (alive) for (const { id, doing } of all) saw(id, doing);
      })
      .catch(() => undefined);
    // Once per front: an effect run twice must not type the same line into a terminal twice.
    if (!restoring) {
      restoring = true;
      void restore();
    }
    const timer = setInterval(look, LOOK_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
      for (const stop of stops) void stop.then((unlisten) => unlisten());
    };
  }, []);
}
