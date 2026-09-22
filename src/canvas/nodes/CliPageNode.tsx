import type { NodeProps } from "@xyflow/react";
import type { CliPageFlowNode } from "../../lib/graph";
import { PageSlot } from "../../page/PageWorkspace";
import { terminalPageId } from "../../page/placement";
import { PageFrame } from "./PageFrame";

export const MIN_WIDTH = 300;
export const MIN_HEIGHT = 140;

export function CliPageNode({ data }: NodeProps<CliPageFlowNode>) {
  return (
    <>
      <PageFrame minWidth={MIN_WIDTH} minHeight={MIN_HEIGHT} widthOnly={data.collapsed} />
      <PageSlot id={terminalPageId(data.session.id)} place="canvas" />
    </>
  );
}
