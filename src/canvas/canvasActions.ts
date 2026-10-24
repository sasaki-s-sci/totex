import { useMemo } from "react";
import type { GraphActions } from "./graphActions";

export function useCanvasActions({
  onOpenWork,
  onNewWork,
  onBrowseWorktree,
  onPickBranch,
  dragBranch,
  onFetch,
  onCloseRepository,
  onCloseFolder,
  openRepository,
  foldRepository,
  toggleJunction,
  resizeTile,
  expand,
  fold,
  setLength,
  reachFold,
  keepFold,
  onShowSession,
  onEndSession,
  onPlaceSession,
  collapseCliPage,
  fitCliPage,
  onCloseFilePreview,
  saveFilePreview,
  refreshFilePreview,
  collapseFilePreview,
  setFilePreviewView,
  previewFilePreview,
  openFileAgain,
  openLinkedFile,
  fitFilePreview,
  pinFilePreview,
}: {
  onOpenWork: GraphActions["openWork"];
  onNewWork: GraphActions["newWork"];
  onBrowseWorktree: GraphActions["browseWorktree"];
  onPickBranch: GraphActions["pickBranch"];
  dragBranch: GraphActions["dragBranch"];
  onFetch: GraphActions["fetchBranch"];
  onCloseRepository: GraphActions["closeRepository"];
  onCloseFolder: GraphActions["closeFolder"];
  openRepository: GraphActions["openRepository"];
  foldRepository: GraphActions["foldRepository"];
  toggleJunction: GraphActions["toggleJunction"];
  resizeTile: GraphActions["resizeTile"];
  expand: GraphActions["expand"];
  fold: GraphActions["fold"];
  setLength: GraphActions["setLength"];
  reachFold: GraphActions["reachFold"];
  keepFold: GraphActions["keepFold"];
  onShowSession: GraphActions["showSession"];
  onEndSession: GraphActions["endSession"];
  onPlaceSession: GraphActions["placeSession"];
  collapseCliPage: GraphActions["collapseCliPage"];
  fitCliPage: GraphActions["fitCliPage"];
  onCloseFilePreview: GraphActions["closeFilePreview"];
  saveFilePreview: GraphActions["saveFilePreview"];
  refreshFilePreview: GraphActions["refreshFilePreview"];
  collapseFilePreview: GraphActions["collapseFilePreview"];
  setFilePreviewView: GraphActions["setFilePreviewView"];
  previewFilePreview: GraphActions["previewFilePreview"];
  openFileAgain: GraphActions["openFileAgain"];
  openLinkedFile: GraphActions["openLinkedFile"];
  fitFilePreview: GraphActions["fitFilePreview"];
  pinFilePreview: GraphActions["pinFilePreview"];
}): GraphActions {
  // One stable value: the provider compares by identity, so a rebuilt callback re-renders every node.
  return useMemo(
    () => ({
      openWork: onOpenWork,
      newWork: onNewWork,
      browseWorktree: onBrowseWorktree,
      pickBranch: onPickBranch,
      dragBranch,
      fetchBranch: onFetch,
      closeRepository: onCloseRepository,
      closeFolder: onCloseFolder,
      openRepository,
      foldRepository,
      toggleJunction,
      resizeTile,
      expand,
      fold,
      setLength,
      reachFold,
      keepFold,
      showSession: onShowSession,
      endSession: onEndSession,
      placeSession: onPlaceSession,
      collapseCliPage,
      fitCliPage,
      closeFilePreview: onCloseFilePreview,
      saveFilePreview,
      refreshFilePreview,
      collapseFilePreview,
      setFilePreviewView,
      previewFilePreview,
      openFileAgain,
      openLinkedFile,
      fitFilePreview,
      pinFilePreview,
    }),
    [
      onOpenWork,
      onNewWork,
      onBrowseWorktree,
      onPickBranch,
      dragBranch,
      onFetch,
      onCloseRepository,
      onCloseFolder,
      openRepository,
      foldRepository,
      toggleJunction,
      resizeTile,
      expand,
      fold,
      setLength,
      reachFold,
      keepFold,
      onShowSession,
      onEndSession,
      onPlaceSession,
      collapseCliPage,
      fitCliPage,
      onCloseFilePreview,
      saveFilePreview,
      refreshFilePreview,
      collapseFilePreview,
      setFilePreviewView,
      previewFilePreview,
      openFileAgain,
      openLinkedFile,
      fitFilePreview,
      pinFilePreview,
    ],
  );
}
