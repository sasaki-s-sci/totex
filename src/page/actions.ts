import type { FilePreviewView } from "../lib/filePreview";

export type FilePageActions = {
  closeFilePreview: (id: number) => void;
  saveFilePreview: (id: number, text: string, expected?: string) => Promise<boolean>;
  collapseFilePreview: (id: number) => void;
  setFilePreviewView: (id: number, view: FilePreviewView) => void;
  previewFilePreview: (id: number) => void;
  fitFilePreview: (id: number, width: number, height?: number) => void;
  pinFilePreview: (id: number) => void;
};
