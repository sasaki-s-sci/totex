import type { FilePreviewView } from "../lib/filePreview";

export type FileReading = { text: string | null; size: number; truncated: boolean };

export type FilePageActions = {
  closeFilePreview: (id: number) => void;
  saveFilePreview: (id: number, text: string, expected?: string) => Promise<boolean>;
  /** What the file now holds, read again because something wrote it. */
  refreshFilePreview: (id: number, read: FileReading) => void;
  collapseFilePreview: (id: number) => void;
  setFilePreviewView: (id: number, view: FilePreviewView) => void;
  previewFilePreview: (id: number) => void;
  /** A file a link on the page points to, opened beside it. */
  openLinkedFile: (id: number, path: string) => void;
  fitFilePreview: (id: number, width: number, height?: number) => void;
  pinFilePreview: (id: number) => void;
};
