/**
 * Replacing the app with a newer release, one half at a time.
 *
 * The pages the window is drawn out of are a small download and a reload; the
 * program under them is a large one and a restart that ends every terminal in
 * the window. So there are two rows, each with its own walk from the offer to
 * the ending, and neither is done because the other was.
 */

export * from "./update/model";
export * from "./update/store";
export * from "./update/take";
