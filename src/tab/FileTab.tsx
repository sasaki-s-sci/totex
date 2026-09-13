import { useEffect, useMemo, useState } from "react";
import { GraphActionsProvider, NO_ACTIONS } from "../canvas/graphActions";
import { readFilePreview } from "../canvas/hooks/useFilePreviewPlacing";
import { FilePreviewCard } from "../canvas/nodes/FilePreviewNode";
import { writeFile } from "../folder/api";
import { refreshChanges } from "../folder/changes";
import { baseName } from "../folder/format";
import { openingView } from "../lib/filePreview";
import type { FilePreviewNodeData } from "../lib/graph";
import type { FileTab as FileTabModel } from "./tab";

const TAB_BOX = { width: 0, height: 0 };

/** A file card standing in the sidebar rather than on the canvas. */
export function FileTab({ tab }: { tab: FileTabModel }) {
  const { path } = tab.file;
  const view = tab.file.view ?? openingView(path);
  const [data, setData] = useState<FilePreviewNodeData>(() => ({
    requestId: tab.file.id,
    path,
    name: baseName(path),
    text: null,
    picture: null,
    size: null,
    truncated: false,
    state: "loading",
    view,
    collapsed: false,
    box: TAB_BOX,
    pinnedAt: null,
    pinnedScale: 1,
  }));

  useEffect(() => {
    let live = true;
    readFilePreview(path, view)
      .then((read) => live && setData((held) => ({ ...held, ...read, state: "ready" })))
      .catch(() => live && setData((held) => ({ ...held, state: "failed" })));
    return () => {
      live = false;
    };
  }, [path, view]);

  const actions = useMemo(
    () => ({
      ...NO_ACTIONS,
      saveFilePreview: async (_id: number, text: string) => {
        if (data.size === null || data.truncated) return false;
        try {
          const size = await writeFile(data.path, text, data.size);
          setData((held) => ({ ...held, text, size }));
          refreshChanges();
          return true;
        } catch {
          return false;
        }
      },
      setFilePreviewView: (_id: number, next: FilePreviewNodeData["view"]) =>
        setData((held) => ({ ...held, view: next })),
    }),
    [data.path, data.size, data.truncated],
  );

  return (
    <GraphActionsProvider value={actions}>
      <div className="tab-file">
        <FilePreviewCard data={data} />
      </div>
    </GraphActionsProvider>
  );
}
