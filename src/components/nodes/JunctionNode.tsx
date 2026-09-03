import type { NodeProps } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import type { JunctionFlowNode } from "../../lib/graph";

/**
 * Where the branches that start the same way are gathered.
 *
 * A knot in the wiring and nothing else: `dev/` is not a ref, so there is
 * nothing to press and nothing to open. The mark says so by being the smallest
 * thing on the canvas — smaller than a commit, which is the least thing on here
 * that is real — and by carrying no name: what it gathers is already written
 * along every line fanning out of it.
 *
 * The name is there for the pointer, which is the one place a word costs the
 * canvas nothing.
 */
export function JunctionNode({ data }: NodeProps<JunctionFlowNode>) {
  const { t } = useTranslation();
  const { prefix, members } = data;

  return (
    <div className="cell junction">
      {/* No `nopan`: there is nothing to press here, so a hand that comes down on
          the knot is a hand on the canvas and should carry it. */}
      <span
        className="mark mark--centred junction__knot"
        title={t("graph.junction", { prefix, count: members })}
      />
    </div>
  );
}
