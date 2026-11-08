import { invoke } from "@tauri-apps/api/core";
import { readImage, readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { copyInto } from "../folder/api.ts";
import { mediaView, pictureType } from "./filePreview.ts";

// Write on the app's host, even when the terminal process runs in WSL or over SSH.
export function copyText(text: string): Promise<void> {
  return writeText(text);
}

/** Text takes precedence; null means an image for the terminal application to read. */
export async function readClipboard(): Promise<string | null> {
  try {
    return await readText();
  } catch (error) {
    try {
      const image = await readImage();
      await image.close();
      return null;
    } catch {
      throw error;
    }
  }
}

export function clipboardFiles(): Promise<string[]> {
  return invoke<string[]>("clipboard_files");
}

async function saveMedia(blob: Blob, into?: string): Promise<string> {
  if (blob.size === 0 || blob.size > 256 * 1024 * 1024) throw new Error("media-size-limit");
  const options = new TextEncoder().encode(JSON.stringify({ mime: blob.type, into }));
  // The parent shell recognizes typed arrays across frames, but not bare ArrayBuffers.
  return invoke<string>("paste_media", new Uint8Array(await blob.arrayBuffer()), {
    headers: { "x-totex-paste": btoa(String.fromCharCode(...options)) },
  });
}

/** Browser files cover native paste events; the host fallback also works in WebViews and WSL. */
export async function pasteMedia(into?: string, data?: DataTransfer | null): Promise<string[]> {
  const blobs: Blob[] = Array.from(data?.files ?? []).filter((file) =>
    /^(image|video)\//.test(file.type),
  );
  if (!blobs.length) {
    const files = (await clipboardFiles().catch(() => [])).filter(
      (path) => pictureType(path) || mediaView(path) === "video",
    );
    if (files.length) return into ? copyInto(files, into) : files;
    const image = await readImage().catch(() => null);
    if (image) {
      try {
        const { width, height } = await image.size();
        if (!width || !height || width * height > 64 * 1024 * 1024)
          throw new Error("media-size-limit");
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("image-encoding-failed");
        const pixels = context.createImageData(width, height);
        pixels.data.set(await image.rgba());
        context.putImageData(pixels, 0, 0);
        blobs.push(
          await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob) => (blob ? resolve(blob) : reject(new Error("image-encoding-failed"))),
              "image/png",
            ),
          ),
        );
      } finally {
        await image.close();
      }
    } else {
      // Some desktops expose recordings only through the browser's clipboard items.
      const items = (await navigator.clipboard?.read().catch(() => [])) ?? [];
      for (const item of items) {
        const type = item.types.find((type) => /^(image|video)\//.test(type));
        if (type) blobs.push(await item.getType(type));
      }
    }
  }
  const paths: string[] = [];
  for (const blob of blobs) paths.push(await saveMedia(blob, into));
  return paths;
}
