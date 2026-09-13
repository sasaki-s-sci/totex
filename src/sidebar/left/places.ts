import type { Place } from "../../folder/api";
import { remember } from "../../lib/remembered";

const PLACES_KEY = "totex.places";

/**
 * Paths only: the row's name and `~` spelling are worked out per machine; see `describeFolders`.
 */
export function keptPlaces(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(PLACES_KEY) ?? "[]");
    // Written by some earlier version: read as a claim, not a fact.
    if (Array.isArray(stored)) return stored.filter((path) => typeof path === "string");
  } catch {}
  return [];
}

export function keepPlaces(places: readonly Place[]): void {
  remember(
    PLACES_KEY,
    places.map((place) => place.path),
  );
}
