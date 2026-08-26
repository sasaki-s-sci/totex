/**
 * What a repository says can be run in it.
 *
 * Four runners and no format of this window's own: mise, Task, just and make
 * each keep a project's commands in a file beside the project, and what comes
 * back from the app is those files read — see `src-tauri/src/tasks`. Nothing
 * here runs anything: a task is a line somebody would have typed, and running
 * one is typing it into a terminal.
 */

import { invoke } from "@tauri-apps/api/core";

/** Which of the four said a line can be run. */
export type Runner = "mise" | "task" | "just" | "make";

/** One thing a repository says can be run in it. */
export type Task = {
  runner: Runner;
  name: string;
  /** What the file says it is for, or "" where it says nothing. */
  about: string;
  /** The line that runs it, exactly as it would be typed, with nothing given
   *  to it — see `runLine` for the line with what it takes on the end. */
  line: string;
  /** What it takes, in the order they are passed. Empty for a task that takes
   *  nothing, and empty for the three runners that have no way to say. */
  params: Param[];
};

/** One thing a task is given when it is run. */
export type Param = {
  name: string;
  /** What the file says it is for, or "" where it says nothing. */
  about: string;
  /** What it stands at when nothing is given, or null where there is none. */
  default: string | null;
  /** Whether it takes the rest of the line rather than one word. */
  variadic: boolean;
  /** Whether the task cannot be run without it. */
  required: boolean;
};

/**
 * Everything the runners in a directory say can be run there.
 *
 * Never fails and never empty for a reason: a runner that is not installed and
 * a folder that holds none of the four both come back as nothing to run, which
 * is the same thing to draw.
 */
export function directoryTasks(path: string): Promise<Task[]> {
  return invoke<Task[]>("directory_tasks", { path });
}

/**
 * The ones worth showing for what has been typed.
 *
 * Every word has to be somewhere in the row, and where is not asked: a name, a
 * runner and a description are three ways of saying what a task is, and
 * somebody typing `test` or `check the` or `just fmt` is naming one of them.
 */
export function matching(tasks: readonly Task[], typed: string): Task[] {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...tasks];
  return tasks.filter((task) => {
    const row = `${task.runner} ${task.name} ${task.about}`.toLowerCase();
    return words.every((word) => row.includes(word));
  });
}

/**
 * The line that runs a task with what has been typed into it.
 *
 * Everything after the last thing given is left off rather than spelled out: a
 * parameter with a default is one the runner fills in itself, and a line
 * carrying every default is a line saying more than was asked for. One left
 * empty in the middle cannot be left off — what follows it is counted from
 * where it stands — so it goes in at whatever it stands at.
 */
export function runLine(task: Task, values: readonly string[]): string {
  let last = -1;
  values.forEach((value, at) => {
    if (value.trim()) last = at;
  });

  const given = task.params.slice(0, last + 1).map((param, at) => {
    const value = values[at]?.trim() || param.default || "";
    // The rest of the line goes in as it was typed, because that is what it is:
    // `*args` is however many words somebody meant, and quoting the lot of them
    // would hand the task one word with spaces in it.
    return param.variadic ? value : quoted(value);
  });

  return [task.line, ...given].join(" ");
}

/** A word that means itself to a shell, and needs nothing done to it. */
const PLAIN = /^[A-Za-z0-9._/:=@,+-]+$/;

/** One value, as it has to be written to arrive as itself. */
function quoted(value: string): string {
  if (PLAIN.test(value)) return value;
  // Single quotes, in which a shell reads everything literally -- and the one
  // character they cannot hold is put in beside them.
  return `'${value.replaceAll("'", "'\\''")}'`;
}
