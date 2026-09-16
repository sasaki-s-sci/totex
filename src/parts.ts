import { type PaneSeed, readSeeds } from "./lib/graphed";
import { onDemand } from "./lib/onDemand";
import type { Workspace } from "./types/git";

/** The canvas is always loaded; everything else stays in its own chunk until asked for. */
export const canvasPart = onDemand(() => import("./canvas/Canvas").then((part) => part.Canvas));
export const cardPart = onDemand(() =>
  import("./window/CardWindow").then((part) => part.CardWindow),
);
export const sidebarPart = onDemand(() =>
  import("./sidebar/RightSidebar").then((part) => part.RightSidebar),
);
/** Same chunk as the right sidebar, so a window with a terminal open has it already. */
export const terminalPart = onDemand(() => import("./tab/CliView").then((part) => part.CliView));
export const commitPart = onDemand(() =>
  import("./menus/CommitMenu").then((part) => part.CommitMenu),
);
export const worktreePart = onDemand(() =>
  import("./menus/WorktreeMenu").then((part) => part.WorktreeMenu),
);
export const tasksPart = onDemand(() => import("./menus/TaskMenu").then((part) => part.TaskMenu));
export const settingsPart = onDemand(() =>
  import("./settings/SettingsContent").then((part) => part.SettingsContent),
);
export const markdownPart = onDemand(() =>
  import("./canvas/nodes/preview/MarkdownReading").then((part) => part.MarkdownReading),
);
export const ROOTS_KEY = "totex.roots";
export const EMPTY_WORKSPACE: Workspace = { root: "file-previews", repositories: [], warnings: [] };

/** Where the panes stood; the graph itself starts empty. */
export function storedRoots(): PaneSeed[] {
  try {
    return readSeeds(JSON.parse(localStorage.getItem(ROOTS_KEY) ?? "[]"));
  } catch {}
  return [];
}

export const schemaPart = onDemand(() =>
  import("./canvas/nodes/preview/SchemaReading").then((part) => part.SchemaReading),
);

export const pdfPart = onDemand(() =>
  import("./canvas/nodes/preview/PdfReading").then((part) => part.PdfReading),
);
export const dxfPart = onDemand(() =>
  import("./canvas/nodes/preview/DxfReading").then((part) => part.DxfReading),
);

export const mediaPart = onDemand(() =>
  import("./canvas/nodes/preview/MediaReading").then((part) => part.MediaReading),
);
export const htmlPart = onDemand(() =>
  import("./canvas/nodes/preview/HtmlReading").then((part) => part.HtmlReading),
);

export const tablePart = onDemand(() =>
  import("./canvas/nodes/preview/TableReading").then((part) => part.TableReading),
);

export const modelPart = onDemand(() =>
  import("./canvas/nodes/preview/ModelReading").then((part) => part.ModelReading),
);

export const epubPart = onDemand(() =>
  import("./canvas/nodes/preview/EpubReading").then((part) => part.EpubReading),
);
