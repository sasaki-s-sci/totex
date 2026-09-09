import i18next from "i18next";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import { ModelReading } from "../../src/components/nodes/preview/ModelReading";
import en from "../../src/i18n/locales/en.json";
import "../../src/canvas/reading.css";

void i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } });
const encode = (bytes: Uint8Array) =>
  `data:application/octet-stream;base64,${btoa(Array.from(bytes, (n) => String.fromCharCode(n)).join(""))}`;
const textSource = (text: string) => encode(new TextEncoder().encode(text));
const positions = new Uint8Array(new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]).buffer);
function gltf(uri?: string) {
  return {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    materials: [
      {
        doubleSided: true,
        pbrMetallicRoughness: { baseColorFactor: [0.1, 0.7, 0.8, 1], metallicFactor: 0 },
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 3,
        type: "VEC3",
        min: [-1, -1, 0],
        max: [1, 1, 0],
      },
    ],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
    buffers: [{ byteLength: positions.byteLength, ...(uri ? { uri } : {}) }],
  };
}
function glb() {
  let json = JSON.stringify(gltf());
  json += " ".repeat((4 - (json.length % 4)) % 4);
  const bytes = new Uint8Array(28 + json.length + positions.byteLength);
  const view = new DataView(bytes.buffer);
  [0x46546c67, 2, bytes.length, json.length, 0x4e4f534a].forEach((n, index) => {
    view.setUint32(index * 4, n, true);
  });
  bytes.set(new TextEncoder().encode(json), 20);
  view.setUint32(20 + json.length, positions.byteLength, true);
  view.setUint32(24 + json.length, 0x004e4942, true);
  bytes.set(positions, 28 + json.length);
  return encode(bytes);
}
const sources: Record<string, string> = {
  obj: textSource(
    "mtllib colors.mtl\nv -1 -1 0\nv 1 -1 0\nv 0 1 0\nv 0 0 1\nf 1 2 3\nf 1 4 2\nf 2 4 3\nf 3 4 1\n",
  ),
  stl: textSource(
    "solid triangle\nfacet normal 0 0 1\nouter loop\nvertex -1 -1 0\nvertex 1 -1 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid triangle\n",
  ),
  gltf: textSource(JSON.stringify(gltf(encode(positions)))),
  glb: glb(),
  external: textSource(JSON.stringify(gltf("https://preview-test.invalid/mesh.bin"))),
  local: textSource(JSON.stringify(gltf("mesh.bin"))),
};
Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke: async (command: string, args: { path: string }) => {
      if (command !== "read_file_data" || args.path !== "/models/mesh.bin")
        throw new Error("Unexpected host request");
      return {
        data: encode(positions).split(",")[1],
        mime: "application/octet-stream",
        size: positions.byteLength,
      };
    },
  },
});

function Fixture() {
  const [format, setFormat] = useState("obj");
  const [broken, setBroken] = useState(false);
  const [visible, setVisible] = useState(true);
  const extension = ["external", "local"].includes(format) ? "gltf" : format;
  return (
    <>
      <select
        aria-label="Format"
        value={format}
        onChange={(event) => setFormat(event.target.value)}
      >
        {Object.keys(sources).map((value) => (
          <option key={value}>{value}</option>
        ))}
      </select>
      <button type="button" onClick={() => setBroken(!broken)}>
        Toggle broken
      </button>
      <button type="button" onClick={() => setVisible(!visible)}>
        Toggle viewer
      </button>
      <section aria-label="Model" style={{ width: 640, height: 480 }}>
        {visible && (
          <ModelReading
            source={broken ? textSource("broken") : sources[format]}
            path={`/models/sample.${extension}`}
            name={`sample.${extension}`}
          />
        )}
      </section>
    </>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
