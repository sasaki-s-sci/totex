import type { FilePreviewView } from "../lib/filePreview";

export type FileReading = {
  text: string | null;
  size: number;
  truncated: boolean;
  /** Read again only by a page that draws the bytes. */
  picture?: string | null;
};

export type FilePageActions = {
  closeFilePreview: (id: number) => void;
  /** `create` writes a file that has been deleted back into being. */
  saveFilePreview: (
    id: number,
    text: string,
    expected?: string,
    create?: boolean,
  ) => Promise<boolean>;
  /** What the file now holds, read again because something wrote it. */
  refreshFilePreview: (id: number, read: FileReading) => void;
  setFilePreviewView: (id: number, view: FilePreviewView) => void;
  /** The file drawn as a page beside it; absent where there is no canvas to put that page on. */
  previewFilePreview?: (id: number) => void;
  /** The same file once more, as a page that follows it, beside one that has stopped. */
  openFileAgain?: (id: number) => void;
  /** A file a link on the page points to, opened beside it. */
  openLinkedFile: (id: number, path: string) => void;
};
