/**
 * The two declarations this page makes, read off the three physical layers.
 *
 * The backend replaces the pages, the application layer and the program one at
 * a time. What a person declares is two things: which application layer to
 * answer from, and which release of the app to be. This module is the whole of
 * the translation between them, kept out of the drawing because it is where the
 * compatibility rules live — and where "what would one press actually move" is
 * worked out, which is the question the arrows on the page and the one button
 * above them are both asking.
 */

import {
  newer,
  type Rung,
  rungOf,
  type UpdateChoice,
  type UpdateState,
  wanted,
} from "../../lib/update";

/** The cycle the application layer is cut on, which is its own. */
export const CORE_CYCLE = "layer";

/** And the cycle a whole release of the app is cut on. */
export const PROGRAM_CYCLE = "release";

/** The declaration that names no version and follows whatever is newest. */
export const LATEST = "latest";

/**
 * The half of a declaration that is not on the version its row is headed by.
 *
 * There is one of these only where the two halves have come apart — pages taken
 * over the top of a program that stayed, which is the ordinary state of a copy
 * the package manager owns, and a passing one anywhere else.
 */
export type Aside = { part: "pages" | "program"; version: string };

/**
 * One declaration as it reads on the page.
 *
 * `at` is what is in place now and is drawn whatever else is true: the page says
 * what this copy is before it says anything about changing it. `to` is set only
 * where taking the declaration would land somewhere else, so a row with no arrow
 * is a row with nothing to do, and the two arrows together are what the one
 * button is offering.
 */
export type Standing = {
  /** The version in place now, of the half this declaration moves. */
  at: string;
  /** The other half, where it is not on the same version. */
  aside: Aside | null;
  /** Where one press would leave it, or null where it is already there. */
  to: string | null;
  /** What the pull-down is on: a version, `latest`, or "" before rungs land. */
  picked: string;
  /** Which release `latest` is on today, so the word can be read as a version. */
  latest: string | null;
  /** The releases this declaration can be pointed at. */
  choices: UpdateChoice[];
  /** The release it resolves to, or null where nothing compatible was found. */
  target: UpdateChoice | null;
  /** Whether either half of it can be replaced by this copy at all. */
  can: boolean;
};

/** The dedicated Core releases whose protocol is known. */
function coreChoices(at: UpdateState): UpdateChoice[] {
  return at.choices.filter(
    (choice) => choice.cycle === CORE_CYCLE && choice.layerProtocol !== null,
  );
}

/** Which Core declaration the first pull-down currently represents. */
function selectedCore(at: UpdateState): UpdateChoice | null {
  const rung = rungOf(at, "app");
  if (!rung) return null;
  const version = rung.cycle === CORE_CYCLE ? wanted(at, "app") : rung.at;
  const released = coreChoices(at).find((choice) => choice.version === version);
  if (released) return released;
  if (version !== rung.at || rung.protocol === null) return null;
  return {
    cycle: CORE_CYCLE,
    version,
    layerProtocol: rung.protocol,
    frontContract: null,
  };
}

/**
 * Whether the program and the application layer would still be talking to one
 * another once this release had been taken.
 *
 * Both halves are what would be in place afterwards rather than what is in
 * place now. The program is this release's where a copy can replace its
 * program, and the one running where it cannot. The layer is the one the Core
 * row names — and where it names none, this release's own, which a program out
 * of that same release speaks by construction.
 *
 * Asked of what is running now on both sides, this refused every release that
 * ever raised the protocol: a copy of 0.1.16 speaks 1, the release that follows
 * it speaks 2, and the one release that copy had to be able to take was the one
 * release it could not see. A release moves all three layers at once, which is
 * what makes it a release rather than three of them.
 */
function talks(
  choice: UpdateChoice,
  core: UpdateChoice,
  program: Rung | null,
  named: boolean,
): boolean {
  const speaks = program?.can ? choice.layerProtocol : (program?.protocol ?? null);
  const heard = named ? core.layerProtocol : choice.layerProtocol;
  return speaks !== null && speaks === heard;
}

/** Front / Program releases compatible with the Core declaration. */
function programChoices(at: UpdateState, core: UpdateChoice | null): UpdateChoice[] {
  if (core?.layerProtocol === null || core === null) return [];
  const program = rungOf(at, "core");
  // Whether the Core row is on a layer of its own, which is the one case where
  // what would be answering afterwards is not what the release carries.
  const named = rungOf(at, "app")?.cycle === CORE_CYCLE;
  return at.choices.filter(
    (choice) =>
      choice.cycle === PROGRAM_CYCLE &&
      talks(choice, core, program, named) &&
      choice.frontContract !== null &&
      // A package-managed program stays where it is, so a selected front must
      // also fit the program that is actually running. Where the program can
      // move, its release carries the matching contract with it.
      (program?.can ||
        (program?.frontContract !== null &&
          program?.frontContract !== undefined &&
          choice.frontContract <= program.frontContract)),
  );
}

/** What one pull-down is on: a version named outright, or `latest`. */
function selectedVersion(at: UpdateState, layer: "app" | "core", cycle: string): string {
  const rung = rungOf(at, layer);
  if (!rung) return "";
  if (rung.cycle !== cycle) return rung.at;
  return rung.picked ?? LATEST;
}

/** The persistent declaration: the application layer, on its own cycle. */
export function coreStanding(at: UpdateState): Standing | null {
  const rung = rungOf(at, "app");
  if (!rung) return null;
  const target = selectedCore(at);
  return {
    at: rung.at,
    aside: null,
    to: rung.can && target && target.version !== rung.at ? target.version : null,
    picked: selectedVersion(at, "app", CORE_CYCLE),
    // What this row means by `latest` however it is set now, because pressing
    // the word is also what moves the row onto the layer's own cycle. Read the
    // same way `wanted` reads it, the layer in place included: a cycle whose
    // newest release is older than the layer this release carries is a cycle
    // with nothing in it to take.
    latest: newer(at.versions[CORE_CYCLE][0] ?? null, rung.at),
    // Listed whether or not this copy can take one: the row says what the
    // releases are either way, and `can` is what decides whether it can be
    // pointed at one of them.
    choices: coreChoices(at),
    target,
    can: rung.can,
  };
}

/**
 * The ephemeral declaration: the release the program and its pages come out of.
 *
 * Two physical layers under one version, and which of them the row is headed by
 * depends on which of them can move. Ordinarily it is the program: it is what a
 * release of the app is, and its pages come with it. Where the program is the
 * package manager's, the pages are the only half that can be brought forward,
 * so they are what the arrow is about and the program is the aside.
 */
export function programStanding(at: UpdateState, core: UpdateChoice | null): Standing | null {
  const program = rungOf(at, "core");
  const front = rungOf(at, "front");
  if (!program || !front) return null;
  const can = program.can || front.can;
  const choices = programChoices(at, core);
  const picked = selectedVersion(at, "core", PROGRAM_CYCLE);
  const target =
    (program.picked === null ? choices[0] : choices.find((choice) => choice.version === picked)) ??
    null;
  const led = program.can ? program : front;
  const other = program.can ? front : program;
  // Where the program moves it takes its pages with it, so both halves are read
  // against the declaration; where it cannot, only the pages are.
  const moves = program.can ? [program.at, front.at] : [front.at];
  return {
    at: led.at,
    aside:
      other.at === led.at ? null : { part: program.can ? "pages" : "program", version: other.at },
    to:
      can && target && moves.some((version) => version !== target.version) ? target.version : null,
    picked,
    // The newest release this half could be moved to rather than the newest
    // there is: a release the program underneath cannot answer is not one
    // `latest` would ever land on.
    latest: choices[0]?.version ?? null,
    choices,
    target,
    can,
  };
}
