/**
 * The version this copy of the app is on, and moving it to another.
 *
 * Two halves. The persistent half holds the terminals and is never moved from
 * here; the ephemeral half is this program and its pages, and is what a
 * release replaces. The backend takes the ephemeral half's pages on their own
 * where that is all a copy can take; the settings present one declaration,
 * which is the release to be on.
 */

export * from "./update/model";
export * from "./update/store";
export * from "./update/take";
