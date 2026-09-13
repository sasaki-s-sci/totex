import type { Commit, Repository, RepositoryDelta, Workspace, WorkspaceDelta } from "../types/git";

/**
 * Identity is the contract: whatever the delta did not mention comes back as the same object, so
 * laid-out nodes are reused.
 */
export function applyWorkspaceDelta(workspace: Workspace, delta: WorkspaceDelta): Workspace {
  if (delta.root !== workspace.root) return workspace;

  const byId = new Map(workspace.repositories.map((repository) => [repository.id, repository]));
  for (const id of delta.removed) byId.delete(id);
  for (const repository of delta.added) byId.set(repository.id, repository);
  for (const change of delta.changed) {
    const previous = byId.get(change.id);
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

function mergeCommits(previous: Commit[], added: Commit[], order: string[]): Commit[] {
  const known = new Map(previous.map((commit) => [commit.id, commit]));
  for (const commit of added) known.set(commit.id, commit);
  return order
    .map((id) => known.get(id))
    .filter((commit): commit is Commit => commit !== undefined);
}
