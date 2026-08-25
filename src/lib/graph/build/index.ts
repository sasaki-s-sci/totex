/**
 * The canvas, built out of a scanned workspace.
 */

import { groupBy } from "../../collections";
import { folderId } from "../folders";
import { prepare } from "../layout";
import {
  type AppNode,
  type Band,
  type Draw,
  type GraphLine,
  type GraphResult,
  type Group,
  REPO_GAP_Y,
  STEP,
} from "../model";
import { folderGroup } from "./group";
import { batched, type Held } from "./nodes";

/**
 * The canvas: one column per folder, and in each of them a row per repository
 * — folded into a single mark, or opened out into a band of its own history —
 * with what is running in each of those rows standing beside it.
 *
 * Everything goes down the page. A folder is the unit somebody put on the graph
 * and it is the unit the canvas is arranged in: its row, and under it the
 * repositories it holds, each set in by one column and joined back to the
 * folder's own mark. So a repository is always in the same place — under its
 * folder, in the order the folder gave — whether it is showing a mark or a
 * thousand commits, and folding one changes what is drawn rather than where
 * anything is.
 *
 * The layouts themselves are cached per repository, so this is the only part
 * that runs when a terminal opens, a fold changes what is shown, or a commit
 * lands somewhere else — and what it does not rebuild comes back as the very
 * objects React Flow already has.
 *
 * A branch carries a stack of the terminals this window has opened in it, in
 * the order they were opened, and nothing at all while it is running nothing.
 * The offer of one is the button on the branch's own ring — see
 * `BranchHeadNode` — so pressing that button puts a mark in the column beside
 * it, which is the whole of what happens on the canvas when work begins.
 *
 * A terminal working somewhere no branch is drawn for — in a folder itself, or
 * in a repository that is folded away — stands beside the row that does draw
 * it: the folder's own row, or that repository's mark. There is no column of
 * homeless terminals off the side of the canvas any more; every one of them is
 * a step from the thing it is working in, which is what a line between them was
 * having to say by crossing the whole graph.
 *
 * This window's own terminals and nothing else. One somebody opened somewhere
 * else cannot be shown in the panel, typed into or ended from here — a pty
 * belongs to the process that made it — and a mark that answers to none of
 * those is a list entry rather than a thing on a canvas.
 */

import type { GraphInput } from "./input";

export type { GraphInput };

export function buildCommitGraph(
  {
    workspace,
    folders,
    visible,
    opened,
    sessions,
    showing,
    asks,
    reports,
    reaching,
    places,
  }: GraphInput,
  previous?: GraphResult,
): GraphResult {
  // By the directory it runs in, not the branch it was started from: a branch
  // cut to be named by the agent working in it is renamed while that agent is
  // still running, and the number a second terminal is told apart by has to be
  // the same one before and after.
  const open = groupBy(sessions, (session) => session.cwd);

  // How many marks each branch's stack will hold, worked out before anything is
  // laid out: a stack that is deeper than the lane it hangs in pushes the rows
  // under it down, which is a shape rather than a filling and so is the
  // layout's own business. Every one of them, crowded or not — a stack is
  // centred on its branch's own line, so the room it takes is split between the
  // row above it and the row below, and the gap between two rows is a sum over
  // both of their stacks. A branch running one terminal reaches half a step up
  // as well as half a step down, and the row above has to know it.
  const deep = new Map<string, number>();
  for (const [cwd, held] of open) deep.set(cwd, held.length);

  const prepared = new Map(
    workspace.repositories.map((repository) => [
      repository.id,
      prepare(repository, visible.get(repository.id), deep),
    ]),
  );

  // Only the bands and the column are ever asked for: a commit node comes back
  // from the repository's own cached layout, already the object it was drawn
  // from. The commits outnumber those by three orders of magnitude, so indexing
  // them here would be the most expensive part of a rebuild that changes
  // nothing.
  const before = new Map<string, Held>();
  for (const node of previous?.nodes ?? []) {
    if (
      node.type === "repository" ||
      node.type === "folder" ||
      node.type === "repo-mark" ||
      node.type === "cli" ||
      node.type === "ask" ||
      node.type === "report"
    ) {
      before.set(node.id, node);
    }
  }

  const nodes: AppNode[] = [];
  const bands: Band[] = [];
  /** The lines that are nobody's band: what a folder holds, and what runs in it. */
  const links: GraphLine[] = [];
  const groups = new Map<string, Group>();
  const draw: Draw = { before };
  /**
   * What a row has already taken for its own stack.
   *
   * A terminal stands in one place and no other, and the rows go down in order
   * — so the first row that draws the directory a terminal is working in keeps
   * it. A directory two repositories both draw, or a folder opened straight
   * onto a repository, is the whole of why this is needed.
   */
  const claimed = new Set<string>();

  /** How far down and how far along what has been laid out reaches. */
  let bottom = 0;
  let right = 0;
  /**
   * Where the next folder that has not been carried anywhere is laid out.
   *
   * Kept apart from `bottom`, which is how far what is drawn actually reaches:
   * a group that was dragged somewhere else still holds the slot it was given,
   * so moving one folder moves nothing else and putting it back puts it back.
   */
  let flowed = 0;

  // One column per folder, down the canvas. A folder is the unit somebody put
  // on the graph, so it is the unit the canvas is arranged in — and a
  // repository never has to be looked for somewhere other than under the folder
  // it came through.
  for (const folder of folders) {
    const held = folder.repositories
      .map((id) => prepared.get(id))
      .filter((entry) => entry !== undefined);

    const at = { x: 0, y: flowed };
    const moved = places.get(folder.root);
    const group = folderGroup(
      { folder, held, opened, open, showing, asks, reports, reaching },
      { x: at.x + (moved?.x ?? 0), y: at.y + (moved?.y ?? 0) },
      claimed,
      draw,
    );

    nodes.push(...group.nodes);
    bands.push(...group.bands);
    links.push(...group.links);
    groups.set(folder.root, {
      node: folderId(folder.root),
      // Where the row itself was laid out, which is the slot plus whatever room
      // its own ring asked for in front of it: what a drop is measured against
      // has to be where the thing dropped was standing.
      at: { x: at.x + group.inset.x, y: at.y + group.inset.y },
      least: group.inset,
      members: group.members,
    });

    right = Math.max(right, group.right);
    bottom = Math.max(bottom, group.bottom);
    flowed += group.height + REPO_GAP_Y;
  }

  return {
    nodes,
    bands,
    groups,
    reach: batched(links),
    // Room for what hangs off the far edge of a band: the offer the cursor
    // draws is a cell past the commit it comes out of.
    extent: { width: right + STEP.x, height: bottom + STEP.y },
  };
}
