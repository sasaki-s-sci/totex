import type { AppNode } from "./flow";

/** Pages are placed by hand and kept where they are; every rebuild steps around them. */
export function isPage(node: AppNode): boolean {
  return node.type === "file-preview" || node.type === "cli-page";
}
