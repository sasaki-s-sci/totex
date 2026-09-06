import type { Layer, UpdateChoice, UpdateState } from "../../lib/update/model";

export const LATEST = "latest";
export type Aside = { part: "pages" | "program"; version: string };
export type Standing = {
  at: string;
  aside: Aside | null;
  to: string | null;
  picked: string;
  latest: string | null;
  choices: UpdateChoice[];
  blocked: UpdateChoice[];
  target: UpdateChoice | null;
  can: boolean;
};

/** A host can serve any number of releases implementing this exact rendering boundary. */
export function compatibleChoices(at: UpdateState, contract: string | null): UpdateChoice[] {
  return contract ? at.choices.filter((choice) => choice.ephemeralContract === contract) : [];
}

export function standing(at: UpdateState, layer: Layer): Standing | null {
  const rung = at.rungs?.find((rung) => rung.layer === layer);
  const persistent = at.rungs?.find((rung) => rung.layer === "persistent");
  if (!rung || !persistent) return null;
  const runtimes = new Map<string, UpdateChoice>();
  for (const choice of at.choices) {
    if (
      !choice.persistentAvailable ||
      !choice.ephemeralContract ||
      runtimes.has(choice.ephemeralContract)
    )
      continue;
    // A newer view release using this host is not a reason to restart the host.
    runtimes.set(
      choice.ephemeralContract,
      choice.ephemeralContract === persistent.ephemeralContract
        ? { ...choice, version: persistent.at }
        : choice,
    );
  }
  const choices =
    layer === "ephemeral"
      ? compatibleChoices(at, persistent.ephemeralContract)
      : [...runtimes.values()];
  const picked = rung.picked ?? LATEST;
  const latest = choices[0]?.version ?? null;
  const target =
    (rung.picked === null ? choices[0] : choices.find((choice) => choice.version === picked)) ??
    null;
  return {
    at: rung.at,
    aside: null,
    picked,
    latest,
    choices,
    blocked: at.choices.filter((choice) =>
      layer === "ephemeral"
        ? !choices.includes(choice)
        : !choice.persistentAvailable || !choice.ephemeralContract,
    ),
    target,
    to: target && target.version !== rung.at ? target.version : null,
    can: rung.can,
  };
}

export const ephemeralStanding = (at: UpdateState) => standing(at, "ephemeral");
export const persistentStanding = (at: UpdateState) => standing(at, "persistent");
