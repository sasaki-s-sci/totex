export const MODEL_BYTE_LIMIT = 16 * 1024 * 1024;
export const MODEL_VERTEX_LIMIT = 1_000_000;
export type ModelFailure =
  | "modelFailed"
  | "modelTooLarge"
  | "modelExternalResources"
  | "modelCompressionUnsupported"
  | "modelEmpty";

export class ModelError extends Error {
  readonly reason: ModelFailure;
  constructor(reason: ModelFailure) {
    super(reason);
    this.reason = reason;
  }
}

export interface ModelResource {
  uri?: string;
  byteLength?: number;
  mimeType?: string;
}
interface ModelJson {
  asset?: { version?: string };
  extensionsUsed?: string[];
  extensionsRequired?: string[];
  buffers?: ModelResource[];
  images?: ModelResource[];
  accessors?: { count: number }[];
  nodes?: { children?: number[] }[];
}

export function modelJson(
  bytes: Uint8Array<ArrayBuffer>,
  format: string,
): { json: ModelJson; binary?: Uint8Array<ArrayBuffer> } {
  if (format === "gltf") return { json: JSON.parse(new TextDecoder().decode(bytes)) };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    format !== "glb" ||
    bytes.length < 20 ||
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a
  )
    throw new ModelError("modelFailed");
  const length = view.getUint32(12, true);
  if (20 + length > bytes.length || length % 4 !== 0) throw new ModelError("modelFailed");
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length)));
  let binary: Uint8Array<ArrayBuffer> | undefined;
  for (let offset = 20 + length; offset < bytes.length; ) {
    if (offset + 8 > bytes.length) throw new ModelError("modelFailed");
    const chunkLength = view.getUint32(offset, true);
    if (chunkLength % 4 !== 0 || offset + 8 + chunkLength > bytes.length)
      throw new ModelError("modelFailed");
    if (view.getUint32(offset + 4, true) === 0x004e4942)
      binary = bytes.subarray(offset + 8, offset + 8 + chunkLength);
    offset += 8 + chunkLength;
  }
  return { json, binary };
}

/** Inspect allocation sizes and resource references before invoking a loader. */
export function inspectModel(
  bytes: Uint8Array<ArrayBuffer>,
  format: string,
): { materialsIgnored: boolean } {
  if (bytes.byteLength > MODEL_BYTE_LIMIT) throw new ModelError("modelTooLarge");
  if (format === "obj") {
    const text = new TextDecoder().decode(bytes);
    let vertices = 0;
    for (const line of text.split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/);
      if (fields[0] === "f") vertices += Math.max(0, fields.length - 3) * 3;
      if (fields[0] === "p" || fields[0] === "l") vertices += fields.length - 1;
      if (vertices > MODEL_VERTEX_LIMIT) throw new ModelError("modelTooLarge");
    }
    return { materialsIgnored: /^\s*mtllib\s/m.test(text) };
  }
  if (format === "stl") {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const faces = bytes.length >= 84 ? view.getUint32(80, true) : 0;
    const binary = bytes.length >= 84 && 84 + faces * 50 === bytes.length;
    if (!binary && !/^.{0,4}solid/.test(new TextDecoder().decode(bytes.subarray(0, 9))))
      throw new ModelError("modelFailed");
    const vertices = binary
      ? faces * 3
      : [...new TextDecoder().decode(bytes).matchAll(/\bvertex\s/g)].length;
    if (vertices > MODEL_VERTEX_LIMIT) throw new ModelError("modelTooLarge");
    return { materialsIgnored: false };
  }
  const { json } = modelJson(bytes, format);
  if (json?.asset?.version !== "2.0") throw new ModelError("modelFailed");
  const extensions = [...(json.extensionsUsed ?? []), ...(json.extensionsRequired ?? [])];
  if (
    extensions.some((name: string) =>
      ["KHR_draco_mesh_compression", "EXT_meshopt_compression", "KHR_texture_basisu"].includes(
        name,
      ),
    )
  )
    throw new ModelError("modelCompressionUnsupported");
  for (const resource of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (resource.uri !== undefined && typeof resource.uri !== "string")
      throw new ModelError("modelExternalResources");
  }
  let allocation = 0;
  for (const accessor of json.accessors ?? []) {
    if (
      !Number.isSafeInteger(accessor.count) ||
      accessor.count < 0 ||
      accessor.count > MODEL_VERTEX_LIMIT * 3
    )
      throw new ModelError("modelTooLarge");
    allocation += accessor.count * 16 * 4;
  }
  const buffers = (json.buffers ?? []).reduce((sum, buffer) => sum + (buffer.byteLength ?? NaN), 0);
  if (
    !Number.isSafeInteger(buffers) ||
    buffers < 0 ||
    buffers > MODEL_BYTE_LIMIT * 2 ||
    allocation > 128 * 1024 * 1024 ||
    (json.nodes?.length ?? 0) > 10_000 ||
    (json.images?.length ?? 0) > 16
  )
    throw new ModelError("modelTooLarge");
  const complete = new Map<number, number>();
  const visiting = new Set<number>();
  function visit(index: number, depth: number): number {
    if (!Number.isInteger(index) || !json.nodes?.[index] || visiting.has(index))
      throw new ModelError("modelFailed");
    if (depth > 128) throw new ModelError("modelTooLarge");
    const known = complete.get(index);
    if (known !== undefined) return known;
    visiting.add(index);
    let height = 0;
    for (const child of json.nodes[index].children ?? [])
      height = Math.max(height, visit(child, depth + 1) + 1);
    if (height > 128) throw new ModelError("modelTooLarge");
    visiting.delete(index);
    complete.set(index, height);
    return height;
  }
  for (let index = 0; index < (json.nodes?.length ?? 0); index++) visit(index, 0);
  return { materialsIgnored: false };
}
