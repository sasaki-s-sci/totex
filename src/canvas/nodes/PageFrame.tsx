import { NodeResizeControl, NodeResizer, ResizeControlVariant } from "@xyflow/react";

/** A folded page is as tall as its bar, so only the side edges are left to drag. */
export function PageFrame({
  minWidth,
  minHeight,
  widthOnly = false,
}: {
  minWidth: number;
  minHeight: number;
  widthOnly?: boolean;
}) {
  if (widthOnly) {
    return (
      <>
        <NodeResizeControl
          className="page__edge"
          variant={ResizeControlVariant.Line}
          position="left"
          resizeDirection="horizontal"
          minWidth={minWidth}
        />
        <NodeResizeControl
          className="page__edge"
          variant={ResizeControlVariant.Line}
          position="right"
          resizeDirection="horizontal"
          minWidth={minWidth}
        />
      </>
    );
  }
  return (
    <NodeResizer
      minWidth={minWidth}
      minHeight={minHeight}
      lineClassName="page__edge"
      handleClassName="page__corner"
    />
  );
}
