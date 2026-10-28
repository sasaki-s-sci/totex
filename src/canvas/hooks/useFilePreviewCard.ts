import { useCallback } from "react";
import { writeAnew, writeFile } from "../../folder/api";
import { refreshChanges } from "../../folder/changes";
import { settingsDocument, writeSettingsText } from "../../lib/appSettings";
import { drawn, type FilePreviewView, openingView, previewable } from "../../lib/filePreview";
import type { FilePreviewFlowNode } from "../../lib/graph";
import type { FileReading } from "../../page/actions";
import type { PageCanvas } from "./useFilePreviews";

export function useFilePreviewCard(
  { standing, setNodes }: PageCanvas,
  previewFile: (path: string, beside: number, view?: FilePreviewView, again?: boolean) => void,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const saveFilePreview = useCallback(
    async (requestId: number, text: string, expected?: string, create = false) => {
      const node = standing.current.find(
        (candidate): candidate is FilePreviewFlowNode =>
          candidate.type === "file-preview" && candidate.data.requestId === requestId,
      );
      // A truncated card is never written: the head on screen would replace the whole file.
      if (!node || node.data.size === null || node.data.truncated) return false;
      try {
        const config = settingsDocument();
        const size =
          config?.path === node.data.path
            ? await writeSettingsText(text, expected ?? node.data.text ?? "")
            : create
              ? await writeAnew(node.data.path, text)
              : await writeFile(node.data.path, text, node.data.size);

        setNodes((current) =>
          current.map((one) =>
            one.type === "file-preview" && one.data.path === node.data.path
              ? { ...one, data: { ...one.data, text, size } }
              : one,
          ),
        );

        refreshChanges();
        return true;
      } catch {
        return false;
      }
    },
    [setNodes],
  );

  const refreshFilePreview = useCallback(
    (requestId: number, read: FileReading) => {
      setNodes((current) =>
        current.map((node) =>
          node.type === "file-preview" && node.data.requestId === requestId
            ? { ...node, data: { ...node.data, ...read } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const setFilePreviewView = useCallback(
    (requestId: number, view: import("../../lib/filePreview").FilePreviewView) => {
      setNodes((current) =>
        current.map((node) =>
          node.type === "file-preview" && node.data.requestId === requestId
            ? { ...node, data: { ...node.data, view } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const previewFilePreview = useCallback(
    (requestId: number) => {
      const node = standing.current.find(
        (candidate): candidate is FilePreviewFlowNode =>
          candidate.type === "file-preview" && candidate.data.requestId === requestId,
      );
      if (!node || drawn(node.data.view) || !previewable(node.data.path)) return;
      previewFile(node.data.path, requestId);
    },
    [previewFile],
  );

  // The file as it now stands on disk, beside a page that has stopped following it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const openFileAgain = useCallback(
    (requestId: number) => {
      const node = standing.current.find(
        (candidate): candidate is FilePreviewFlowNode =>
          candidate.type === "file-preview" && candidate.data.requestId === requestId,
      );
      if (node) previewFile(node.data.path, requestId, "text", true);
    },
    [previewFile],
  );

  // A markdown file stays a reading; anything else opens the way it would from the sidebar.
  const openLinkedFile = useCallback(
    (requestId: number, path: string) =>
      previewFile(
        path,
        requestId,
        /\.(md|markdown|mdx)$/i.test(path) ? "markdown" : openingView(path),
      ),
    [previewFile],
  );

  return {
    saveFilePreview,
    refreshFilePreview,
    setFilePreviewView,
    previewFilePreview,
    openFileAgain,
    openLinkedFile,
  };
}
