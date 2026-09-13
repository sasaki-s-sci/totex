import type { NodeProps } from "@xyflow/react";
import { type CSSProperties, useState } from "react";
import { useTranslation } from "react-i18next";
import { JUNCTION_SIZE, type JunctionFlowNode } from "../../lib/graph";
import { useGraphActions } from "../graphActions";

export function JunctionNode({ id, data }: NodeProps<JunctionFlowNode>) {
  const { t } = useTranslation();
  const { prefix, members, closed } = data;
  const { toggleJunction } = useGraphActions();
  // The way is read off the state at the press, not `closed`, which only changes once the graph is rebuilt.
  const [turn, setTurn] = useState<{ count: number; way: "shut" | "open" } | null>(null);

  return (
    // One measure for the drawing, the word's air and JUNCTION_TRIM, handed to the stylesheet.
    <div className="cell junction" style={{ "--knot": `${JUNCTION_SIZE}px` } as CSSProperties}>
      <span className="junction__name">{`${prefix}/`}</span>
      <button
        type="button"
        className="mark mark--centred nopan junction__knot"
        title={t("graph.junction", { prefix, count: members })}
        aria-expanded={!closed}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setTurn((held) => ({ count: (held?.count ?? 0) + 1, way: closed ? "open" : "shut" }));
          toggleJunction(id);
        }}
      >
        <svg
          // Keyed by the press so every turn is a fresh drawing of the arms.
          key={turn?.count ?? 0}
          className={`junction__arms${turn ? ` is-turning is-turning--${turn.way}` : ""}`}
          viewBox={`0 0 ${JUNCTION_SIZE} ${JUNCTION_SIZE}`}
          aria-hidden="true"
        >
          {ARMS.map(({ degrees, ...ends }) => (
            <line key={degrees} {...ends} />
          ))}
        </svg>
      </button>
    </div>
  );
}

// Lines, not gradient bars: a tile snaps to a whole pixel before the turn, and three arms then miss the centre.
const ARMS = [90, 30, 150].map((degrees) => {
  const half = JUNCTION_SIZE / 2;
  const angle = (degrees * Math.PI) / 180;
  // Rounded so the upright arm lands exactly on the centre rather than cos(90°) off it.
  const dx = Math.round(half * Math.cos(angle) * 1000) / 1000;
  const dy = Math.round(half * Math.sin(angle) * 1000) / 1000;
  return { degrees, x1: half - dx, y1: half - dy, x2: half + dx, y2: half + dy };
});
