import type { XYPosition } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { type Band, type CommitFlowNode, DOT_SIZE, type Hold, type Point } from "../../lib/graph";
import { useGraphActions } from "../graphActions";
import { type CommitDot, commitAt } from "./bands";
import { BRANCH_LIFT, BRANCH_RADIUS, HALO_RADIUS, holdRun, useUnder } from "./under";

const MARK_RADIUS = 10;

// Drawn as paths: an icon font glyph inside a foreignObject got no size at all in WebKit.
const FOLD =
  "M -8 -4 L -4.5 0 L -8 4 M -5 -4 L -1.5 0 L -5 4 M 8 -4 L 4.5 0 L 8 4 M 5 -4 L 1.5 0 L 5 4";

const BRANCH = "M -6 -3 H 6 M -1 -3 C 2 -3, 2 4, 5 4";

export function Hover({
  bands,
  holds,
  standing,
  selected,
  onCommit,
}: {
  bands: readonly Band[];

  holds: readonly Hold[];
  standing: ReadonlyMap<string, XYPosition>;

  selected: string | null;
  onCommit: (node: CommitFlowNode, at: { x: number; y: number }) => void;
}) {
  const { fold, foldRepository } = useGraphActions();
  const under = useUnder(bands, holds, standing, onCommit);

  if (!under) return null;

  if (under.kind === "hold") {
    const drawn = holdRun(under.hold, standing);
    if (!drawn) return null;
    return (
      <FoldOffer
        run={drawn.run}
        at={drawn.at}
        reach={under.reach}
        onFold={() => foldRepository(under.hold.repository)}
      />
    );
  }

  const { band, dot } = under;
  const offer = under.fold;
  const bandAt = standing.get(band.id) ?? band;
  const dotAt = dot ? commitAt(dot, standing) : null;

  return (
    <g transform={`translate(${bandAt.x} ${bandAt.y})`}>
      {dotAt && <circle className="commit-hover" cx={dotAt.x} cy={dotAt.y} r={HALO_RADIUS} />}

      {dot && dotAt && dot.node.id !== selected && (
        <BranchOffer node={dot.node} at={dotAt} onCommit={onCommit} />
      )}

      {offer && (
        <FoldOffer
          run={offer.run}
          at={offer.at}
          reach={under.reach}
          onFold={() => fold(band.id, offer.keep)}
        />
      )}
    </g>
  );
}

function FoldOffer({
  run,
  at,
  reach,
  onFold,
}: {
  run: readonly number[];

  at: Point;

  reach: number;
  onFold: () => void;
}) {
  const { t } = useTranslation();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a button here is HTML in a foreignObject, which is what left the mark empty in WebKit
    <g
      className="edge__fold"
      role="button"
      aria-label={t("graph.fold")}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onFold();
      }}
    >
      <path className="edge__hit" d={runPath(run)} style={{ strokeWidth: reach * 2 }} />
      <g className="edge__mark" transform={`translate(${at.x} ${at.y})`}>
        <circle className="edge__mark__disc" r={MARK_RADIUS} />
        <path className="edge__mark__arrows" d={FOLD} />
      </g>
    </g>
  );
}

function BranchOffer({
  node,
  at,
  onCommit,
}: {
  node: CommitFlowNode;

  at: Point;
  onCommit: (node: CommitFlowNode, at: { x: number; y: number }) => void;
}) {
  const { t } = useTranslation();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a button here is HTML in a foreignObject, which is what left the fold mark empty in WebKit
    <g
      className="commit-branch nopan"
      role="button"
      aria-label={t("commit.branch")}
      transform={`translate(${at.x} ${at.y - BRANCH_LIFT})`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onCommit(node, { x: event.clientX, y: event.clientY });
      }}
    >
      <circle className="commit-branch__disc" r={BRANCH_RADIUS} />
      <path className="commit-branch__mark" d={BRANCH} />
    </g>
  );
}

function runPath(run: readonly number[]): string {
  let path = `M ${run[0]},${run[1]}`;
  for (let index = 2; index + 1 < run.length; index += 2) {
    path += ` L ${run[index]},${run[index + 1]}`;
  }
  return path;
}

export function CommitEmphasis({
  bands,
  standing,
  selected,
  picked,
  onCommit,
}: {
  bands: readonly Band[];
  standing: ReadonlyMap<string, XYPosition>;
  selected: string | null;
  picked: string | null;
  onCommit: (node: CommitFlowNode, at: { x: number; y: number }) => void;
}) {
  if (!selected && !picked) return null;

  const marks: { band: Band; dot: CommitDot; selected: boolean; picked: boolean }[] = [];
  for (const band of bands) {
    for (const dot of band.lines.dots.values()) {
      const isSelected = dot.node.id === selected;
      const isPicked = dot.node.id === picked;
      if (isSelected || isPicked) marks.push({ band, dot, selected: isSelected, picked: isPicked });
    }
  }

  return (
    <>
      {marks.map((mark) => {
        const bandAt = standing.get(mark.band.id) ?? mark.band;
        const at = commitAt(mark.dot, standing);
        return (
          <g key={mark.dot.node.id} transform={`translate(${bandAt.x} ${bandAt.y})`}>
            {mark.picked && <circle className="commit-pick" cx={at.x} cy={at.y} r={DOT_SIZE / 2} />}
            {mark.selected && (
              <>
                <circle className="commit-selection" cx={at.x} cy={at.y} r={HALO_RADIUS} />
                <BranchOffer node={mark.dot.node} at={at} onCommit={onCommit} />
              </>
            )}
          </g>
        );
      })}
    </>
  );
}
