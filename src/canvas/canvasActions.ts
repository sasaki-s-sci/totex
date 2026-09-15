import { useMemo } from "react";
import type { GraphActions } from "./graphActions";

export function useCanvasActions({
  onOpenWork,
  onBrowseWorktree,
  onPickBranch,
  dragBranch,
  onFetch,
  onCloseRepository,
  onCloseFolder,
  openRepository,
  foldRepository,
  toggleJunction,
  expand,
  fold,
  reachFold,
  keepFold,
  onShowSession,
  onEndSession,
  onDockSession,
  collapseCliPage,
  fitCliPage,
  onAnswer,
  onReply,
  onPoint,
  onPick,
  onTake,
  onCloseFilePreview,
  saveFilePreview,
  collapseFilePreview,
  setFilePreviewView,
  previewFilePreview,
  fitFilePreview,
  pinFilePreview,
}: {
  onOpenWork: GraphActions["openWork"];
  onBrowseWorktree: GraphActions["browseWorktree"];
  onPickBranch: GraphActions["pickBranch"];
  dragBranch: GraphActions["dragBranch"];
  onFetch: GraphActions["fetchBranch"];
  onCloseRepository: GraphActions["closeRepository"];
  onCloseFolder: GraphActions["closeFolder"];
  openRepository: GraphActions["openRepository"];
  foldRepository: GraphActions["foldRepository"];
  toggleJunction: GraphActions["toggleJunction"];
  expand: GraphActions["expand"];
  fold: GraphActions["fold"];
  reachFold: GraphActions["reachFold"];
  keepFold: GraphActions["keepFold"];
  onShowSession: GraphActions["showSession"];
  onEndSession: GraphActions["endSession"];
  onDockSession: GraphActions["dockSession"];
  collapseCliPage: GraphActions["collapseCliPage"];
  fitCliPage: GraphActions["fitCliPage"];
  onAnswer: GraphActions["answer"];
  onReply: GraphActions["reply"];
  onPoint: GraphActions["point"];
  onPick: GraphActions["pick"];
  onTake: GraphActions["take"];
  onCloseFilePreview: GraphActions["closeFilePreview"];
  saveFilePreview: GraphActions["saveFilePreview"];
  collapseFilePreview: GraphActions["collapseFilePreview"];
  setFilePreviewView: GraphActions["setFilePreviewView"];
  previewFilePreview: GraphActions["previewFilePreview"];
  fitFilePreview: GraphActions["fitFilePreview"];
  pinFilePreview: GraphActions["pinFilePreview"];
}): GraphActions {
  // One stable value: the provider compares by identity, so a rebuilt callback re-renders every node.
  return useMemo(
    () => ({
      openWork: onOpenWork,
      browseWorktree: onBrowseWorktree,
      pickBranch: onPickBranch,
      dragBranch,
      fetchBranch: onFetch,
      closeRepository: onCloseRepository,
      closeFolder: onCloseFolder,
      openRepository,
      foldRepository,
      toggleJunction,
      expand,
      fold,
      reachFold,
      keepFold,
      showSession: onShowSession,
      endSession: onEndSession,
      dockSession: onDockSession,
      collapseCliPage,
      fitCliPage,
      answer: onAnswer,
      reply: onReply,
      point: onPoint,
      pick: onPick,
      take: onTake,
      closeFilePreview: onCloseFilePreview,
      saveFilePreview,
      collapseFilePreview,
      setFilePreviewView,
      previewFilePreview,
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
      onCloseFolder,
      openRepository,
      foldRepository,
      toggleJunction,
      expand,
      fold,
      reachFold,
      keepFold,
      onShowSession,
      onEndSession,
      onDockSession,
      collapseCliPage,
      fitCliPage,
      onAnswer,
      onReply,
      onPoint,
      onPick,
      onTake,
      onCloseFilePreview,
      saveFilePreview,
      collapseFilePreview,
      setFilePreviewView,
      previewFilePreview,
      fitFilePreview,
      pinFilePreview,
    ],
  );
}
