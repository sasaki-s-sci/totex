import { modelResourcePath } from "../../../lib/modelResourcePath.ts";
import { MODEL_BYTE_LIMIT, ModelError, type ModelResource, modelJson } from "./modelSource.ts";

export type ModelResourceReader = (path: string, uri: string) => Promise<Uint8Array<ArrayBuffer>>;

/** Resolve only bounded embedded or adjacent assets; the renderer sees blob URLs. */
export async function prepareModel(
  bytes: Uint8Array<ArrayBuffer>,
  format: string,
  path: string,
  read: ModelResourceReader,
) {
  const { json, binary } = modelJson(bytes, format);
  const urls: string[] = [];
  const release = () => {
    for (const url of urls) URL.revokeObjectURL(url);
  };
  let total = bytes.byteLength;
  const resources = [...(json.buffers ?? []), ...(json.images ?? [])];
  if (resources.length > 32) throw new ModelError("modelTooLarge");
  try {
    for (const resource of resources) {
      let data: Uint8Array<ArrayBuffer>;
      let type = resource.mimeType ?? "application/octet-stream";
      if (resource.uri === undefined) {
        if (resource !== json.buffers?.[0] || !binary) continue;
        data = binary;
      } else if (/^data:/i.test(resource.uri)) {
        const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(resource.uri);
        if (!match) throw new ModelError("modelFailed");
        type = match[1] || type;
        data = match[2]
          ? Uint8Array.from(atob(match[3]), (character) => character.charCodeAt(0))
          : new TextEncoder().encode(decodeURIComponent(match[3]));
      } else {
        modelResourcePath(path, resource.uri);
        data = await read(path, resource.uri);
        type = resource.mimeType ?? imageType(resource);
      }
      total += data.byteLength;
      if (data.byteLength > MODEL_BYTE_LIMIT || total > MODEL_BYTE_LIMIT * 2)
        throw new ModelError("modelTooLarge");
      const url = URL.createObjectURL(new Blob([data], { type }));
      urls.push(url);
      resource.uri = url;
    }
    return { data: JSON.stringify(json), release };
  } catch (error) {
    release();
    if (
      error instanceof Error &&
      (error.message === "modelTooLarge" || error.message === "modelExternalResources")
    )
      throw new ModelError(error.message);
    throw error;
  }
}

function imageType(resource: ModelResource) {
  switch (resource.uri?.split(".").pop()?.toLowerCase()) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    default:
      return "application/octet-stream";
  }
}
