import type { Branch, Repository } from "../../types/git";

export function trunkOf(repository: Repository): Branch | undefined {
  return (
    repository.branches.find((branch) => branch.isHead) ??
    repository.branches.find((branch) => branch.refName === repository.defaultBranch)
  );
}

/** Where a new workspace is cut: the default branch's tip, else the trunk's, else the latest commit. */
export function newWorkBase(repository: Repository): {
  branch: Branch | undefined;
  commit: string | undefined;
} {
  const branch =
    repository.branches.find((candidate) => candidate.refName === repository.defaultBranch) ??
    trunkOf(repository);
  return { branch, commit: branch?.commit ?? repository.commits[0]?.id };
}
