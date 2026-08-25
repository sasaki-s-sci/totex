/**
 * What the pointer brings out on a line: the fold it sits on, and the branch a
 * commit offers.
 */

import type { XYPosition } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { type Band, type CommitFlowNode, DOT_SIZE, type Point } from "../../lib/graph";
import { useGraphActions } from "../graphActions";
import { type CommitDot, commitAt } from "./bands";
import { BRANCH_LIFT, BRANCH_RADIUS, HALO_RADIUS, useUnder } from "./under";

/** How far the fold mark reaches out from the line it sits on. */
const MARK_RADIUS = 10;

/**
 * The arrows, drawn rather than set: an icon font's glyph inside an SVG
 * `foreignObject` is at the mercy of the engine, and WebKit gave it no size at
 * all. These are plain paths in the graph's own coordinates.
 */
const FOLD =
  "M -8 -4 L -4.5 0 L -8 4 M -5 -4 L -1.5 0 L -5 4 M 8 -4 L 4.5 0 L 8 4 M 5 -4 L 1.5 0 L 5 4";

/** The mark on the offer of a branch: history carrying on, and a branch peeling
 * off it, drawn small enough to sit on a disc. */
const BRANCH = "M -6 -3 H 6 M -1 -3 C 2 -3, 2 4, 5 4";

export function Hover({
  bands,
  standing,
  selected,
  onCommit,
}: {
  bands: readonly Band[];
  standing: ReadonlyMap<string, XYPosition>;
  /** The commit already wearing an offer of its own, which is not drawn twice. */
  selected: string | null;
  onCommit: (node: CommitFlowNode, at: { x: number; y: number }) => void;
}) {
  const { t } = useTranslation();
  const { fold } = useGraphActions();
  const under = useUnder(bands, standing, onCommit);

  if (!under) return null;
  const { band, dot } = under;
  const offer = under.fold;
  const bandAt = standing.get(band.id) ?? band;
  const dotAt = dot ? commitAt(dot, standing) : null;

  return (
    <g transform={`translate(${bandAt.x} ${bandAt.y})`}>
      {/* The commit the cursor is on, wearing the halo everything on this canvas
          wears while it is live under the pointer. The branch a press here would
          cut used to be drawn with it, dotted, out to where its head would go —
          a preview of a thing nobody had asked for, laid over the history the
          cursor was reading. The offer standing over the dot says as much, and
          it is the mark that answers. */}
      {dotAt && <circle className="commit-hover" cx={dotAt.x} cy={dotAt.y} r={HALO_RADIUS} />}

      {/* The offer of a branch, over the dot itself. The selected commit is
          already wearing one, drawn with its halo, so it is not drawn again
          here: two of the same mark in the same place is one too many. */}
      {dot && dotAt && dot.node.id !== selected && (
        <BranchOffer node={dot.node} at={dotAt} onCommit={onCommit} />
      )}

      {offer && (
        // biome-ignore lint/a11y/useSemanticElements: a button here is HTML in a foreignObject, which is what left the mark empty in WebKit
        <g
          className="edge__fold"
          role="button"
          aria-label={t("graph.fold")}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            fold(band.id, offer.keep);
          }}
        >
          {/* The line again, drawn in nothing and thick enough to be aimed at:
              the whole stretch is the button, the way it reads. */}
          <path
            className="edge__hit"
            d={runPath(offer.run)}
            style={{ strokeWidth: under.reach * 2 }}
          />
          {/* On the line's own middle, where a mark is furthest from the marks
              at either end of it. */}
          <g className="edge__mark" transform={`translate(${offer.at.x} ${offer.at.y})`}>
            {/* Canvas, so the line does not run through the arrows. */}
            <circle className="edge__mark__disc" r={MARK_RADIUS} />
            <path className="edge__mark__arrows" d={FOLD} />
          </g>
        </g>
      )}
    </g>
  );
}

/**
 * The offer of a branch, standing over the commit it would be cut from.
 *
 * The one thing a commit is for, and now the one thing that says so: the mark
 * used to be inside the menu a commit opened, which meant a press to be shown
 * what could be done and another to do it. It is on the canvas instead, over
 * the dot, and what the menu is left holding is the only part of cutting a
 * branch that cannot be a mark — its name.
 *
 * It is `nopan` because everything else about a commit is worked out from where
 * the cursor is rather than from what it is over: the press that walks a dot
 * and the click that keeps the canvas from clearing the selection both stand
 * aside for this one element, which answers for itself.
 */
function BranchOffer({
  node,
  at,
  onCommit,
}: {
  node: CommitFlowNode;
  /** The dot it stands over, in the band's own coordinates. */
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
      {/* Canvas, so the halo under it does not run through the mark. */}
      <circle className="commit-branch__disc" r={BRANCH_RADIUS} />
      <path className="commit-branch__mark" d={BRANCH} />
    </g>
  );
}

/** The line the pointer is on, as something that can be drawn. */
function runPath(run: readonly number[]): string {
  let path = `M ${run[0]},${run[1]}`;
  for (let index = 2; index + 1 < run.length; index += 2) {
    path += ` L ${run[index]},${run[index + 1]}`;
  }
  return path;
}

/** Selection and keyboard focus are the only commit marks not shared in a batch. */
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
            {/* The dot again, in the ink that says `here`: what the walk has
                reached is the commit, not the cell it stands in. Drawn over the
                batch rather than in it — see `.commit-pick`. */}
            {mark.picked && <circle className="commit-pick" cx={at.x} cy={at.y} r={DOT_SIZE / 2} />}
            {mark.selected && (
              <>
                <circle className="commit-selection" cx={at.x} cy={at.y} r={HALO_RADIUS} />
                {/* Left out on the commit that was reached rather than only on
                    the one under the cursor: a commit walked to with the cursor
                    keys is a commit with nothing on it to press otherwise. */}
                <BranchOffer node={mark.dot.node} at={at} onCommit={onCommit} />
              </>
            )}
          </g>
        );
      })}
    </>
  );
}
