/**
 * The declaration this page makes, read off the two physical layers.
 *
 * The backend replaces the pages and the program one at a time. What a person
 * declares is one thing: which release of the app to be. This module is the
 * whole of the translation between them, kept out of the drawing because it is
 * where the compatibility rule lives — and where "what would one press
 * actually move" is worked out, which is the question the arrows on the page
 * and the one button above them are both asking.
 */

import { rungOf, type UpdateChoice, type UpdateState } from "../../lib/update";

/** The cycle a whole release of the app is cut on. */
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
 * is a row with nothing to do, and the arrow is what the one button is offering.
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

/** The releases of the app this copy could be moved to. */
function programChoices(at: UpdateState): UpdateChoice[] {
  const program = rungOf(at, "core");
  return at.choices.filter(
    (choice) =>
      choice.cycle === PROGRAM_CYCLE &&
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

/** What the pull-down is on: a version named outright, or `latest`. */
function selectedVersion(at: UpdateState): string {
  const rung = rungOf(at, "core");
  if (!rung) return "";
  if (rung.cycle !== PROGRAM_CYCLE) return rung.at;
  return rung.picked ?? LATEST;
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
export function programStanding(at: UpdateState): Standing | null {
  const program = rungOf(at, "core");
  const front = rungOf(at, "front");
  if (!program || !front) return null;
  const can = program.can || front.can;
  const choices = programChoices(at);
  const picked = selectedVersion(at);
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
