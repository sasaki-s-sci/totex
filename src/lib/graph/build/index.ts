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
  type Hold,
  REPO_GAP_Y,
  STEP,
} from "../model";
import { folderGroup } from "./group";
import type { GraphInput } from "./input";
import { batched, type Held } from "./nodes";

export type { GraphInput };

export function buildCommitGraph(
  {
    workspace,
    folders,
    visible,
    opened,
    closed,
    sessions,
    showing,
    asks,
    reports,
    reaching,
    places,
  }: GraphInput,
  previous?: GraphResult,
): GraphResult {
  // By directory, not branch: an agent renames its branch while running and the ordinal must survive it.
  const open = groupBy(sessions, (session) => session.cwd);

  // Stack depths before layout: a stack is centred on its line and pushes the rows either side.
  const deep = new Map<string, number>();
  for (const [cwd, held] of open) deep.set(cwd, held.length);

  const prepared = new Map(
    workspace.repositories.map((repository) => [
      repository.id,
      prepare(repository, visible.get(repository.id), deep, closed),
    ]),
  );

  // Commits are not indexed: they come back from the cached layout and outnumber these a thousand to one.
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

  const links: GraphLine[] = [];
  const holds: Hold[] = [];
  const groups = new Map<string, Group>();
  const draw: Draw = { before };

  const claimed = new Set<string>();

  let bottom = 0;
  let right = 0;

  // Kept apart from `bottom`: a dragged group still holds its slot, so moving one folder moves nothing else.
  let flowed = 0;

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
    holds.push(...group.holds);
    groups.set(folder.root, {
      node: folderId(folder.root),

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
    holds,

    // A cell past the edge, for the offer the cursor draws.
    extent: { width: right + STEP.x, height: bottom + STEP.y },
  };
}
