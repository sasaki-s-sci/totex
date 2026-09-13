import { useEffect, useState } from "react";
import type { CommitFlowNode } from "../../lib/graph";
import { commitMessage } from "../../lib/message";

export function useCommitMessage(commit: CommitFlowNode | null): string | null {
  const repository = commit?.data.repository.id ?? null;
  const oid = commit?.data.commit.id ?? null;
  // The subject stands in until the full message arrives, or forever if git will not answer.
  const [read, setRead] = useState<{ oid: string; said: string } | null>(null);

  useEffect(() => {
    if (!repository || !oid) return;
    let asking = true;
    commitMessage(repository, oid)
      .then((said) => {
        if (asking) setRead({ oid, said });
      })
      .catch(() => {});
    return () => {
      asking = false;
    };
  }, [repository, oid]);

  if (!commit) return null;
  return read?.oid === oid ? read.said : commit.data.commit.subject;
}
