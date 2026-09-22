// One row for both layers. A release is a patch or a minor by its number alone:
// a patch is on the running line and never ends a terminal, a minor is on
// another line and is installed and restarted into. A patch is one of two
// things, which the shell contract says: pages drawn in place, or a program
// installed with the window reopened over the running service.
import type { Layer, UpdateChoice, UpdateState } from "./model";

export const LATEST = "latest";

export type Reading = {
  /** The version being drawn. */
  at: string;
  /** The version of the program running. */
  app: string;
  /** What the row is pointed at: a version by name, or `latest`. */
  picked: string;
  /** The newest release the row could take, by whichever button. */
  latest: string | null;
  /** Releases the pull-down offers, newest first. */
  choices: UpdateChoice[];
  /** Releases shown but not offered: the wrong program, or no program for this copy. */
  blocked: UpdateChoice[];
  /** What the patch button takes: on the running line, terminals kept. */
  patch: UpdateChoice | null;
  /** Whether the patch installs the program and reopens the window, rather than drawing in place. */
  reopens: boolean;
  /** What the minor button takes: installed and restarted into, terminals closed. */
  minor: UpdateChoice | null;
  can: boolean;
};

function ahead(one: string, than: string): boolean {
  const left = one.split(".").map(Number);
  const right = than.split(".").map(Number);
  for (let part = 0; part < Math.max(left.length, right.length); part += 1) {
    const a = left[part] ?? 0;
    const b = right[part] ?? 0;
    // Not `>`: a version that is not three numbers never claims to be ahead.
    if (a !== b) return a > b;
  }
  return false;
}

export function newer(one: string | null, other: string | null): string | null {
  if (one === null) return other;
  if (other === null) return one;
  return ahead(other, one) ? other : one;
}

/** The line a version is on: `major.minor`, which is what the service speaks. */
export function lineOf(version: string): string {
  return version.split(".").slice(0, 2).join(".");
}

/** Which layer a release is taken by: the pages alone, or the whole program. */
export function layerOf(at: UpdateState, choice: UpdateChoice): Layer | null {
  const persistent = at.rungs?.find((rung) => rung.layer === "persistent");
  const ephemeral = at.rungs?.find((rung) => rung.layer === "ephemeral");
  if (!persistent || !ephemeral || !choice.ephemeralContract) return null;
  if (choice.ephemeralContract === persistent.ephemeralContract)
    return ephemeral.can ? "ephemeral" : null;
  return persistent.can && choice.persistentAvailable ? "persistent" : null;
}

export function reading(at: UpdateState): Reading | null {
  const persistent = at.rungs?.find((rung) => rung.layer === "persistent");
  const ephemeral = at.rungs?.find((rung) => rung.layer === "ephemeral");
  if (!persistent || !ephemeral) return null;
  const choices = at.choices.filter((choice) => layerOf(at, choice) !== null);
  const blocked = at.choices.filter((choice) => !choices.includes(choice));
  const picked = ephemeral.picked ?? persistent.picked ?? LATEST;
  const line = lineOf(persistent.at);
  let patch: UpdateChoice | null = null;
  let minor: UpdateChoice | null = null;
  if (picked === LATEST) {
    // Newest on the running line, and the newest line beyond it. A line behind
    // the running one is a downgrade, which nobody takes without naming it.
    patch =
      choices.find(
        (choice) =>
          lineOf(choice.version) === line &&
          (layerOf(at, choice) === "ephemeral" || ahead(choice.version, persistent.at)),
      ) ?? null;
    minor =
      choices.find(
        (choice) => lineOf(choice.version) !== line && ahead(choice.version, persistent.at),
      ) ?? null;
  } else {
    const named = choices.find((choice) => choice.version === picked) ?? null;
    if (named && lineOf(named.version) === line) patch = named;
    if (named && lineOf(named.version) !== line) minor = named;
  }
  return {
    at: ephemeral.at,
    app: persistent.at,
    picked,
    latest: newer(patch?.version ?? null, minor?.version ?? null),
    choices,
    blocked,
    patch,
    reopens: patch !== null && layerOf(at, patch) === "persistent",
    minor,
    can: ephemeral.can || persistent.can,
  };
}

/** What a press through one layer takes: the row's pin, or the newest it could take. */
export function wanted(at: UpdateState, layer: Layer): string | null {
  const read = reading(at);
  if (!read) return null;
  const target =
    read.patch && layerOf(at, read.patch) === layer
      ? read.patch
      : layer === "persistent"
        ? read.minor
        : null;
  if (target) return target.version;
  // Nothing to move to: a press is for keeping up with what is in place.
  return layer === "ephemeral" ? read.at : read.app;
}
