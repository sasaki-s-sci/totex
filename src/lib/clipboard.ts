import { readImage, readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

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
