import { invoke } from "@tauri-apps/api/core";

export type Runner = "totex" | "mise" | "task" | "just" | "make";

export type Task = {
  runner: Runner;
  name: string;
  about: string;
  line: string;
  params: Param[];
};

export type Param = {
  name: string;
  about: string;
  default: string | null;
  variadic: boolean;
  required: boolean;
};

export function directoryTasks(path: string): Promise<Task[]> {
  return invoke<Task[]>("directory_tasks", { path });
}

export function matching(tasks: readonly Task[], typed: string): Task[] {
  const words = typed.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...tasks];
  return tasks.filter((task) => {
    const row = `${task.runner} ${task.name} ${task.about}`.toLowerCase();
    return words.every((word) => row.includes(word));
  });
}

/**
 * Trailing defaults are left off; an empty one in the middle goes in at its default, since position
 * counts.
 */
export function runLine(task: Task, values: readonly string[]): string {
  let last = -1;
  values.forEach((value, at) => {
    if (value.trim()) last = at;
  });

  const given = task.params.slice(0, last + 1).map((param, at) => {
    const value = values[at]?.trim() || param.default || "";
    // Rest arguments go in as typed: quoting would make them one word.
    return param.variadic ? value : quoted(value);
  });

  return [task.line, ...given].join(" ");
}

const PLAIN = /^[A-Za-z0-9._/:=@,+-]+$/;

/** Single quotes; the one character they cannot hold is spliced in beside them. */
function quoted(value: string): string {
  if (PLAIN.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
