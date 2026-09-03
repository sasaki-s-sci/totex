/** The whole of what the commit the walk is standing on says. */

import { useEffect, useState } from "react";
import type { CommitFlowNode } from "../lib/graph";
import { commitMessage } from "../lib/message";

/**
 * The whole of what one commit says, asked for while somebody is stopped on it.
 *
 * Asked at the press rather than kept, which is how everything on this canvas
 * that costs a crossing is read — see `useCliTyped`, which takes the same kind
 * of reading for the terminals. A walk steps from commit to commit as fast as a
 * key repeats, and the answer for a commit the walk has already left is thrown
 * away rather than drawn.
 *
 * The subject stands in until the rest of it arrives, and stays where it never
 * does: the canvas already has that line, and a message that went blank while
 * an answer was on its way would read as a commit that says nothing.
 */
export function useCommitMessage(commit: CommitFlowNode | null): string | null {
  const repository = commit?.data.repository.id ?? null;
  const oid = commit?.data.commit.id ?? null;
  const [read, setRead] = useState<{ oid: string; said: string } | null>(null);

  useEffect(() => {
    if (!repository || !oid) return;
    let asking = true;
    commitMessage(repository, oid)
      .then((said) => {
        if (asking) setRead({ oid, said });
      })
      .catch(() => {
        // A commit git will not answer for is a commit drawn as its subject,
        // which is what it was already drawn as.
      });
    return () => {
      asking = false;
    };
  }, [repository, oid]);

  if (!commit) return null;
  return read?.oid === oid ? read.said : commit.data.commit.subject;
}
