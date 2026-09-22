import type { NodeProps } from "@xyflow/react";
import type { FilePreviewFlowNode } from "../../lib/graph";
import { PageSlot } from "../../page/PageWorkspace";
import { filePageId } from "../../page/placement";
import { FILE_LEAST, SETTINGS_LEAST } from "../hooks/filePreviewBox";
import { PageFrame } from "./PageFrame";

export function FilePreviewNode({ data }: NodeProps<FilePreviewFlowNode>) {
  const least = data.view === "settings" ? SETTINGS_LEAST : FILE_LEAST;
  return (
    <>
      <PageFrame minWidth={least.width} minHeight={least.height} widthOnly={data.collapsed} />
      <PageSlot id={filePageId(data.requestId)} place="canvas" />
    </>
  );
}
