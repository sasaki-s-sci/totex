/**
 * What one build of the canvas comes to: the nodes, the lines, and the boxes
 * they are drawn in.
 */

import type { AppNode, CommitFlowNode } from "./flow";
import type { GraphLine, StrokeStyle } from "./stroke";

export type FoldTarget = {
  /** The line as a run of points, which the pointer is measured against. */
  run: number[];
  /** Where the mark goes when the pointer is on it. */
  at: { x: number; y: number };
  /** How much history is left showing once it is folded. */
  keep: number;
  /** How much would go with it; there is no offer when it is none. */
  hides: number;
};

/**
 * Every line one repository draws, batched by how it is drawn.
 *
 * The batching is the whole point: a thousand lines of one colour are one path
 * with a thousand pieces in it, and the engine is asked for one element instead
 * of a thousand. Named lines are kept out of it — a name is set along its own
 * line and needs a path it can be pointed at.
 */
export type BandLines = {
  strokes: { key: string; stroke: StrokeStyle; parts: GraphLine[] }[];
  named: GraphLine[];
  /** What can be folded, by the cell of the grid the pointer would be in. */
  folds: Map<string, FoldTarget[]>;
  /**
   * Where each commit's dot is, by the cell it sits in.
   *
   * What the offer of a branch is drawn from: the pointer is on a commit when
   * it is on the dot, and the offer is a curve out of that dot. One entry per
   * commit, which is what makes finding it a division rather than a search.
   */
  dots: Map<string, { at: { x: number; y: number }; node: CommitFlowNode }>;
};

export type GraphResult = {
  nodes: AppNode[];
  /** The bands, in the order they are drawn, each with its lines. */
  bands: Band[];
  /**
   * Every line that is not one repository's own: what a folder holds, and what
   * is running in the rows a folder draws.
   *
   * Drawn on the canvas rather than inside a band, because both ends of these
   * are the canvas's — a folder's mark and the band of a repository opened out
   * of it are two things standing on it, and neither is inside the other.
   *
   * Batched by colour, the way a band batches its own lines: a canvas with a
   * score of these on it is a handful of paths.
   */
  reach: { key: string; stroke: StrokeStyle; parts: GraphLine[] }[];
  /**
   * The folder groups, by the directory each was opened on.
   *
   * What the canvas is arranged in and what it is moved in: a group is a folder
   * and everything under it, so dragging the folder's own mark takes the whole
   * of it. `at` is where the group would stand if nobody had moved it, which is
   * what a drag is measured against; `members` is everything standing in it
   * that is not inside something else already listed — a band carries its own
   * commits, so only the band itself is here.
   */
  groups: ReadonlyMap<string, Group>;
  /**
   * How far what is drawn reaches, which is the box the lines are given.
   *
   * An SVG root clips to its own box whatever it is told about overflow, and
   * the bands under the repositories — the places the canvas does not draw —
   * are exactly where the longest of these lines end.
   */
  extent: { width: number; height: number };
};

/**
 * One folder and everything laid out under it, as the canvas holds it.
 *
 * A folder is the unit somebody put on the graph, so it is the unit the canvas
 * is arranged in and the unit it is rearranged in: the row, the repositories in
 * it — folded into a mark or opened into a band — and whatever is running in
 * any of them all move together, because they are one thing.
 */
export type Group = {
  /** The folder's own node, which is the one thing here that is dragged. */
  node: string;
  /** Where the group is laid out, before anything was moved by hand. */
  at: { x: number; y: number };
  /**
   * The nearest the folder's own node can be put to the corner of the canvas.
   *
   * Nothing in a group is usually above or to the left of the row that heads
   * it, and this is then the corner itself. A folder whose terminals are set
   * round it has marks on both those sides, and the lines are drawn in one box
   * that starts at the corner: a group carried past this would keep its marks
   * and lose what joins them.
   */
  least: { x: number; y: number };
  /**
   * Everything else that travels with it, by node id.
   *
   * Only what stands on the canvas in its own right: a band's commits are
   * placed inside the band and follow it without being named here.
   */
  members: readonly string[];
};

/**
 * A repository's band: where it sits on the canvas, and what is drawn in it.
 *
 * The lines are held in the band's own coordinates and the band is moved by a
 * transform, so laying the canvas out again moves a repository without a single
 * line being worked out afresh.
 */
export type Band = {
  id: string;
  x: number;
  y: number;
  /** The box the band was given, which is what the canvas is measured from. */
  width: number;
  height: number;
  lines: BandLines;
  /**
   * What joins each branch to the terminals working in it.
   *
   * Apart from `lines` because these are the one thing in a band that is not
   * the repository: a terminal opening changes them and changes nothing else,
   * and the layout they hang off is handed back untouched.
   */
  runs: BandLines["strokes"];
  /**
   * The whole band is what a pull is reaching for rather than what the
   * repository is showing.
   *
   * Every line and mark in it is drawn dashed while that is so, which is one
   * class on the band's own group — see `GraphLines` — rather than a different
   * stroke on each of a thousand lines. Let go, and the band is rebuilt at the
   * depth it reached with nothing provisional about it.
   */
  provisional?: boolean;
};
