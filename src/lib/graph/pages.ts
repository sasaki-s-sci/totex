/**
 * Which nodes are pages: opened onto the graph rather than built out of it.
 *
 * A file card, the settings page and a terminal stood on the canvas are placed
 * by hand and stay where they are put; everything else is laid out again for
 * every commit that lands. So wherever the canvas rebuilds, reconciles or draws
 * lines from its nodes, these are the ones it steps around.
 */

import type { AppNode } from "./flow";

export function isPage(node: AppNode): boolean {
  return node.type === "file-preview" || node.type === "cli-page";
}
