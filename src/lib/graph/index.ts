/**
 * The commit graph: what the canvas is made of, and how it is built.
 *
 * Four parts, in the order a change moves through them — `model` is the
 * vocabulary; `history` and `branches` deal out the cells one repository takes,
 * which `layout` turns into the nodes and lines of a band; and `build` lays the
 * bands out and draws what is running on them. Everything the window needs
 * comes out here; the rest is between them.
 */

export type { AskCard, AskFlowNode, AskNodeData } from "./asking";
export { buildCommitGraph, type GraphInput } from "./build";
export { isOpen } from "./folders";
export {
  circlesOf,
  distanceTo,
  type Point,
  shortOf,
  sigmoidPath,
  straightPath,
} from "./geometry";
export { commitNodeId } from "./history";
export { foldCell } from "./lines";
export {
  type AppNode,
  type Band,
  type BandLines,
  type BranchHeadData,
  type BranchHeadFlowNode,
  type CliFlowNode,
  type CliNodeData,
  COLUMN_WIDTH,
  COMMIT_STEP,
  type CollapseFlowNode,
  type CommitFlowNode,
  type CommitNodeData,
  DOT_SIZE,
  type Fetch,
  type FilePreviewBox,
  type FilePreviewFlowNode,
  type FilePreviewNodeData,
  FOLDER_INSET,
  type FolderFlowNode,
  type FolderNodeData,
  type FoldTarget,
  type GraphLine,
  type GraphResult,
  gridMove,
  HEAD_SIZE,
  LANE_HEIGHT,
  LINE_COLOR,
  type LineEnd,
  NAME_COLUMN,
  onCell,
  REMOTE_HEAD_SIZE,
  type RefKind,
  type RepoMarkData,
  type RepoMarkFlowNode,
  type RepositoryFlowNode,
  type RepositoryNodeData,
  STEP,
  type StrokeStyle,
} from "./model";
export type { CardStep, ReportCard, ReportFlowNode, ReportNodeData } from "./reporting";
