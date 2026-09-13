import { readFileData } from "../folder/api";
import { modelResourcePath } from "./modelResourcePath";

/** Adjacent buffers and textures go through the same bounded host API as the model. */
export async function localModelResource(
  modelPath: string,
  uri: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const file = await readFileData(modelResourcePath(modelPath, uri));
  if (file.data === null) throw new Error("modelTooLarge");
  return Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0));
}
