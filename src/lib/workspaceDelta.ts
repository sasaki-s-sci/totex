/**
 * Applies what the backend reported as changed onto the workspace on screen.
 *
 * Identity is the contract: everything the delta did not mention comes back as
 * the very same object, down to individual commits. That is what lets the graph
 * be rebuilt from a repository it has already laid out without touching a node.
 */

import type { Commit, Repository, RepositoryDelta, Workspace, WorkspaceDelta } from "../types/git";

export function applyWorkspaceDelta(workspace: Workspace, delta: WorkspaceDelta): Workspace {
  // A delta for a folder we are no longer showing: the scan of the new one is
  // already on its way and it is the one that is right.
  if (delta.root !== workspace.root) return workspace;

  const byId = new Map(workspace.repositories.map((repository) => [repository.id, repository]));
  for (const id of delta.removed) byId.delete(id);
  for (const repository of delta.added) byId.set(repository.id, repository);
  for (const change of delta.changed) {
    const previous = byId.get(change.id);
    // Nothing to patch onto: the repository this describes is not one we have.
    if (previous) byId.set(change.id, patchRepository(previous, change));
  }

  const order = delta.order ?? workspace.repositories.map((repository) => repository.id);
  const repositories = order
    .map((id) => byId.get(id))
    .filter((repository): repository is Repository => repository !== undefined);

  const warnings = delta.warnings ?? workspace.warnings;
  if (
    warnings === workspace.warnings &&
    repositories.length === workspace.repositories.length &&
    repositories.every((repository, index) => repository === workspace.repositories[index])
  ) {
    return workspace;
  }

  return { root: workspace.root, repositories, warnings };
}

function patchRepository(previous: Repository, change: RepositoryDelta): Repository {
  return {
    ...previous,
    ...change.summary,
    branches: change.branches ?? previous.branches,
    worktrees: change.worktrees ?? previous.worktrees,
    commits: change.commits
      ? mergeCommits(previous.commits, change.commits.added, change.commits.order)
      : previous.commits,
  };
}

/** Rebuilds the history from the order it now has, reusing the bodies we hold. */
function mergeCommits(previous: Commit[], added: Commit[], order: string[]): Commit[] {
  const known = new Map(previous.map((commit) => [commit.id, commit]));
  for (const commit of added) known.set(commit.id, commit);
  return order
    .map((id) => known.get(id))
    .filter((commit): commit is Commit => commit !== undefined);
}
