import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareModel } from "../src/components/nodes/preview/modelAssets.ts";
import {
  inspectModel,
  MODEL_BYTE_LIMIT,
  modelJson,
} from "../src/components/nodes/preview/modelSource.ts";

const bytes = (value) =>
  new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value));
const gltf = (extra = {}) => ({ asset: { version: "2.0" }, ...extra });

test("model preflight rejects excessive allocations and decoder extensions before loading", () => {
  assert.throws(() => inspectModel(new Uint8Array(MODEL_BYTE_LIMIT + 1), "stl"), /modelTooLarge/);
  assert.throws(
    () => inspectModel(bytes(gltf({ accessors: [{ count: 1e10 }] })), "gltf"),
    /modelTooLarge/,
  );
  assert.throws(
    () => inspectModel(bytes(gltf({ buffers: [{ byteLength: 1e10 }] })), "gltf"),
    /modelTooLarge/,
  );
  assert.throws(
    () => inspectModel(bytes(gltf({ extensionsUsed: ["KHR_draco_mesh_compression"] })), "gltf"),
    /modelCompressionUnsupported/,
  );
  assert.throws(() => inspectModel(bytes("broken"), "glb"), /modelFailed/);
  assert.throws(() => inspectModel(new Uint8Array(100), "stl"), /modelFailed/);
  assert.throws(
    () => inspectModel(bytes(gltf({ nodes: [{ children: [0] }] })), "gltf"),
    /modelFailed/,
  );
  assert.throws(
    () =>
      inspectModel(
        bytes(
          gltf({
            nodes: Array.from({ length: 140 }, (_, index) => ({
              children: index ? [index - 1] : [],
            })),
          }),
        ),
        "gltf",
      ),
    /modelTooLarge/,
  );
  assert.deepEqual(inspectModel(bytes("mtllib colors.mtl\nv 0 0 0\nf 1 2 3"), "obj"), {
    materialsIgnored: true,
  });
});

test("model resources resolve sibling assets without network and revoke generated URLs", async () => {
  const calls = [];
  const source = bytes(
    gltf({
      buffers: [{ byteLength: 3, uri: "mesh.bin" }],
      images: [{ uri: "textures/color.png" }],
    }),
  );
  const prepared = await prepareModel(source, "gltf", "/models/scene.gltf", async (...args) => {
    calls.push(args);
    return Uint8Array.of(1, 2, 3);
  });
  const result = JSON.parse(prepared.data);
  assert.deepEqual(calls, [
    ["/models/scene.gltf", "mesh.bin"],
    ["/models/scene.gltf", "textures/color.png"],
  ]);
  assert.match(result.buffers[0].uri, /^blob:/);
  assert.deepEqual(
    new Uint8Array(await (await fetch(result.buffers[0].uri)).arrayBuffer()),
    Uint8Array.of(1, 2, 3),
  );
  prepared.release();
  await assert.rejects(fetch(result.buffers[0].uri));
});

test("embedded resources become blobs and forbidden paths never reach the host reader", async () => {
  const noRead = async () => {
    throw new Error("Unexpected host read");
  };
  const prepared = await prepareModel(
    bytes(gltf({ buffers: [{ byteLength: 3, uri: "data:application/octet-stream;base64,AQID" }] })),
    "gltf",
    "/models/scene.gltf",
    noRead,
  );
  assert.match(JSON.parse(prepared.data).buffers[0].uri, /^blob:/);
  prepared.release();
  for (const uri of ["https://example.com/a.bin", "../secret.bin", "/secret.bin", "blob:foreign"]) {
    await assert.rejects(
      prepareModel(bytes(gltf({ buffers: [{ uri }] })), "gltf", "/models/scene.gltf", noRead),
      /modelExternalResources/,
    );
  }
});

test("GLB JSON and binary chunks are validated and resolved without a host read", async () => {
  let json = JSON.stringify(gltf({ buffers: [{ byteLength: 4 }] }));
  json += " ".repeat((4 - (json.length % 4)) % 4);
  const data = new Uint8Array(12 + 8 + json.length + 8 + 4);
  const view = new DataView(data.buffer);
  [0x46546c67, 2, data.length, json.length, 0x4e4f534a].forEach((n, i) => {
    view.setUint32(i * 4, n, true);
  });
  data.set(bytes(json), 20);
  view.setUint32(20 + json.length, 4, true);
  view.setUint32(24 + json.length, 0x004e4942, true);
  data.set([1, 2, 3, 4], 28 + json.length);
  assert.deepEqual(modelJson(data, "glb").binary, Uint8Array.of(1, 2, 3, 4));
  const prepared = await prepareModel(data, "glb", "/models/a.glb", async () => {
    throw new Error("Unexpected read");
  });
  assert.match(JSON.parse(prepared.data).buffers[0].uri, /^blob:/);
  prepared.release();
  view.setUint32(12, 0xffffffff, true);
  assert.throws(() => modelJson(data, "glb"), /modelFailed/);
});
