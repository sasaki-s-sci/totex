/**
 * The canvas's own answers to what a mark can be pressed to do, gathered into
 * the one value the nodes read them through.
 */

import { useMemo } from "react";
import type { GraphActions } from "./graphActions";

/**
 * Everything a mark can be pressed to do, gathered into one value.
 *
 * Stable, so that handing it down does not make every node look changed: the
 * provider's value is compared by identity, so a single callback rebuilt per
 * graph would re-render every edge and every node on the canvas — which is the
 * cost `reconcile` exists to avoid.
 */
export function useCanvasActions({
  onOpenWork,
  onBrowseWorktree,
  onPickBranch,
  dragBranch,
  onFetch,
  onCloseRepository,
  openRepository,
  foldRepository,
  toggleFolder,
  expand,
  fold,
  reachFold,
  keepFold,
  onShowSession,
  onEndSession,
  onAnswer,
  onReply,
  onPoint,
  onPick,
  onCompose,
  onTake,
  onCloseFilePreview,
  onCloseSettings,
  saveFilePreview,
  collapseFilePreview,
  fitFilePreview,
  pinFilePreview,
}: {
  onOpenWork: GraphActions["openWork"];
  onBrowseWorktree: GraphActions["browseWorktree"];
  onPickBranch: GraphActions["pickBranch"];
  dragBranch: GraphActions["dragBranch"];
  onFetch: GraphActions["fetchBranch"];
  onCloseRepository: GraphActions["closeRepository"];
  openRepository: GraphActions["openRepository"];
  foldRepository: GraphActions["foldRepository"];
  toggleFolder: GraphActions["toggleFolder"];
  expand: GraphActions["expand"];
  fold: GraphActions["fold"];
  reachFold: GraphActions["reachFold"];
  keepFold: GraphActions["keepFold"];
  onShowSession: GraphActions["showSession"];
  onEndSession: GraphActions["endSession"];
  onAnswer: GraphActions["answer"];
  onReply: GraphActions["reply"];
  onPoint: GraphActions["point"];
  onPick: GraphActions["pick"];
  onCompose: GraphActions["compose"];
  onTake: GraphActions["take"];
  onCloseFilePreview: GraphActions["closeFilePreview"];
  onCloseSettings: GraphActions["closeSettings"];
  saveFilePreview: GraphActions["saveFilePreview"];
  collapseFilePreview: GraphActions["collapseFilePreview"];
  fitFilePreview: GraphActions["fitFilePreview"];
  pinFilePreview: GraphActions["pinFilePreview"];
}): GraphActions {
  return useMemo(
    () => ({
      openWork: onOpenWork,
      browseWorktree: onBrowseWorktree,
      pickBranch: onPickBranch,
      dragBranch,
      fetchBranch: onFetch,
      closeRepository: onCloseRepository,
      openRepository,
      foldRepository,
      toggleFolder,
      expand,
      fold,
      reachFold,
      keepFold,
      showSession: onShowSession,
      endSession: onEndSession,
      answer: onAnswer,
      reply: onReply,
      point: onPoint,
      pick: onPick,
      compose: onCompose,
      take: onTake,
      closeFilePreview: onCloseFilePreview,
      closeSettings: onCloseSettings,
      saveFilePreview,
      collapseFilePreview,
      fitFilePreview,
      pinFilePreview,
    }),
    [
      onOpenWork,
      onBrowseWorktree,
      onPickBranch,
      dragBranch,
      onFetch,
      onCloseRepository,
      openRepository,
      foldRepository,
      toggleFolder,
      expand,
      fold,
      reachFold,
      keepFold,
      onShowSession,
      onEndSession,
      onAnswer,
      onReply,
      onPoint,
      onPick,
      onCompose,
      onTake,
      onCloseFilePreview,
      onCloseSettings,
      saveFilePreview,
      collapseFilePreview,
      fitFilePreview,
      pinFilePreview,
    ],
  );
}
