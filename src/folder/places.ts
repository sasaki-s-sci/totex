import { remember } from "../lib/remembered";
import type { Place } from "./api";

/** Where the folders someone kept are held between windows. */
const PLACES_KEY = "totex.places";

/**
 * The folders that were kept, as the paths they were kept by.
 *
 * Paths and nothing else: what a row shows — the folder's name, and the path
 * with the home directory written `~` — is worked out from the path every time
 * the menu opens, so a window that has been moved to another machine shows
 * those folders the way that machine spells them rather than the way the last
 * one did. See `describeFolders`.
 */
export function keptPlaces(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PLACES_KEY) ?? "[]");
    // Whatever is under the key was written by some earlier version of this
    // window, so it is read as a claim rather than as a fact: anything that is
    // not a list of paths is read as no folders kept, which is what a window
    // that has never kept one has anyway.
    if (Array.isArray(stored)) return stored.filter((path) => typeof path === "string");
  } catch {
    // A window that cannot remember them offers the machine's own places, which
    // is what the menu is for in the first place.
  }
  return [];
}

/** Holds them for the next window -- see `remember`. */
export function keepPlaces(places: readonly Place[]): void {
  remember(
    PLACES_KEY,
    places.map((place) => place.path),
  );
}
