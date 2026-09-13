// One row for both layers. A release is a patch or a minor by its number alone:
// a patch shares the running program's shell contract and is drawn in place, a
// minor carries another contract and is installed and restarted into.
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
  /** What the patch button takes: drawn in place, nothing stopped. */
  patch: UpdateChoice | null;
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
  let patch: UpdateChoice | null = null;
  let minor: UpdateChoice | null = null;
  if (picked === LATEST) {
    // Newest on the running line, and the newest line beyond it. A line behind
    // the running one is a downgrade, which nobody takes without naming it.
    patch = choices.find((choice) => layerOf(at, choice) === "ephemeral") ?? null;
    minor =
      choices.find(
        (choice) => layerOf(at, choice) === "persistent" && ahead(choice.version, persistent.at),
      ) ?? null;
  } else {
    const named = choices.find((choice) => choice.version === picked) ?? null;
    if (named && layerOf(at, named) === "ephemeral") patch = named;
    if (named && layerOf(at, named) === "persistent") minor = named;
  }
  return {
    at: ephemeral.at,
    app: persistent.at,
    picked,
    latest: newer(patch?.version ?? null, minor?.version ?? null),
    choices,
    blocked,
    patch,
    minor,
    can: ephemeral.can || persistent.can,
  };
}

/** What a press on one layer takes: the row's pin, or the newest it could take. */
export function wanted(at: UpdateState, layer: Layer): string | null {
  const read = reading(at);
  if (!read) return null;
  const target = layer === "ephemeral" ? read.patch : read.minor;
  if (target) return target.version;
  // Nothing to move to: a press is for keeping up with what is in place.
  return layer === "ephemeral" ? read.at : read.app;
}
