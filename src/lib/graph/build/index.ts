import { groupBy } from "../../collections";
import type { Session } from "../../session";
import { folderId, groupKey } from "../folders";
import { prepare } from "../layout";
import {
  type AppNode,
  type Band,
  type Draw,
  type GraphLine,
  type GraphResult,
  type Group,
  type Hold,
  type OfferFlowNode,
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
  // A directory can stand on the canvas twice, as a folder and as a repository's checkout. A
  // terminal goes to the folder when its row opened it, or when no repository answers for where
  // it runs; every other one is a branch's.
  const rows = new Set(
    folders.filter((folder) => folder.kind === "folder").map((folder) => folder.root),
  );
  const answered = new Set<string>();
  for (const repository of workspace.repositories) {
    answered.add(repository.path);
    for (const worktree of repository.worktrees) answered.add(worktree.path);
  }
  const ofFolder = (session: Session) =>
    !answered.has(session.cwd) || (session.folder === true && rows.has(session.cwd));

  // By directory, not branch: an agent renames its branch while running and the ordinal must survive it.
  const open = groupBy(
    sessions.filter((session) => !ofFolder(session)),
    (session) => session.cwd,
  );
  const beside = groupBy(sessions.filter(ofFolder), (session) => session.cwd);

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
  const offers: OfferFlowNode[] = [];
  const bands: Band[] = [];

  const links: GraphLine[] = [];
  const holds: Hold[] = [];
  const groups = new Map<string, Group>();
  const offered = new Map((previous?.offers ?? []).map((offer) => [offer.id, offer]));
  const draw: Draw = { before, offered };

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
    const key = groupKey(folder);
    const moved = places.get(key);
    const group = folderGroup(
      {
        folder,
        held,
        opened,
        open: folder.kind === "folder" ? beside : open,
        showing,
        asks,
        reports,
        reaching,
      },
      { x: at.x + (moved?.x ?? 0), y: at.y + (moved?.y ?? 0) },
      claimed,
      draw,
    );

    nodes.push(...group.nodes);
    offers.push(...group.offers);
    bands.push(...group.bands);
    links.push(...group.links);
    holds.push(...group.holds);
    // A repository has no row of its own above it: nothing drawn, nothing to move.
    const handle = folder.kind === "folder" ? folderId(folder.root) : group.members[0];
    if (handle === undefined) continue;
    const stands = group.nodes.find((node) => node.id === handle)?.position;
    groups.set(key, {
      node: handle,

      // Where the handle would stand unmoved: a drag is measured from there.
      at: stands
        ? { x: stands.x - (moved?.x ?? 0), y: stands.y - (moved?.y ?? 0) }
        : { x: at.x + group.inset.x, y: at.y + group.inset.y },
      least: group.inset,
      members: group.members,
    });

    right = Math.max(right, group.right);
    bottom = Math.max(bottom, group.bottom);
    flowed += group.height + REPO_GAP_Y;
  }

  return {
    nodes,
    offers,
    bands,
    groups,
    reach: batched(links),
    holds,

    // A cell past the edge, for the offer the cursor draws.
    extent: { width: right + STEP.x, height: bottom + STEP.y },
  };
}
