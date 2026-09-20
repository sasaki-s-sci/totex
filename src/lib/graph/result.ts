import type { AppNode, CommitFlowNode, OfferFlowNode } from "./flow";
import type { GraphLine, StrokeStyle } from "./stroke";

export type FoldTarget = {
  run: number[];
  at: { x: number; y: number };
  /** Commits left showing once folded. */
  keep: number;
  hides: number;
};

/** Lines batched by stroke into one path each; named lines stay separate. */
export type BandLines = {
  strokes: { key: string; stroke: StrokeStyle; parts: GraphLine[] }[];
  named: GraphLine[];
  /** By the grid cell the pointer would be in. */
  folds: Map<string, FoldTarget[]>;
  dots: Map<string, { at: { x: number; y: number }; node: CommitFlowNode }>;
};

/** A folder-to-band line the pointer can fold at; there is no band index for these. */
export type Hold = {
  line: GraphLine;
  repository: string;
};

export type GraphResult = {
  nodes: AppNode[];
  /** Kept out of `nodes`: they are on the canvas only while Ctrl+Shift is held. */
  offers: OfferFlowNode[];
  bands: Band[];
  /** Lines between canvas-level things: folder reach and folder-row terminals. */
  reach: { key: string; stroke: StrokeStyle; parts: GraphLine[] }[];
  holds: Hold[];
  groups: ReadonlyMap<string, Group>;
  /** The box the line SVG is given; an SVG root clips to it regardless of overflow. */
  extent: { width: number; height: number };
};

/** A folder and everything under it, which moves as one. */
export type Group = {
  node: string;
  /** Where the group is laid out before being moved by hand. */
  at: { x: number; y: number };
  /** Nearest the folder node may go to the canvas corner without ring marks leaving the line box. */
  least: { x: number; y: number };
  /** Canvas-level members only; a band carries its own commits. */
  members: readonly string[];
};

/** Lines are in band coordinates and the band moves by transform. */
export type Band = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  lines: BandLines;
  /** Branch-to-terminal lines, apart from `lines` since terminals change without the layout. */
  runs: BandLines["strokes"];
  /** A pull reaching past what is shown: drawn dashed by one class on the band group. */
  provisional?: boolean;
};
