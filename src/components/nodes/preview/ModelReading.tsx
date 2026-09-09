import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Box3,
  type BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  LoadingManager,
  type Material,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { localModelResource } from "../../../lib/modelResources";
import { sourceBytes } from "./documentSource";
import { prepareModel } from "./modelAssets";
import {
  inspectModel,
  MODEL_BYTE_LIMIT,
  MODEL_VERTEX_LIMIT,
  ModelError,
  type ModelFailure,
} from "./modelSource";
import "./modelReading.css";

function disposeModel(roots: Object3D[]) {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  for (const root of roots)
    root.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.geometry) geometries.add(mesh.geometry);
      for (const material of Array.isArray(mesh.material)
        ? mesh.material
        : mesh.material
          ? [mesh.material]
          : [])
        materials.add(material);
      const skinned = object as Mesh & { skeleton?: { dispose(): void } };
      skinned.skeleton?.dispose();
    });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) {
    const image = texture.source?.data;
    if (typeof ImageBitmap !== "undefined" && image instanceof ImageBitmap) image.close();
    texture.dispose();
  }
}

async function loadModel(bytes: Uint8Array<ArrayBuffer>, format: string, path: string) {
  if (format === "stl" || format === "obj") {
    const model =
      format === "stl"
        ? new Mesh(
            new STLLoader().parse(bytes.buffer),
            new MeshStandardMaterial({ color: 0x83b9d3, roughness: 0.65, side: DoubleSide }),
          )
        : new OBJLoader().parse(new TextDecoder().decode(bytes));
    return { model, dispose: () => disposeModel([model]) };
  }
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    if (!/^(?:data:|blob:)/i.test(url)) throw new ModelError("modelExternalResources");
    return url;
  });
  const assets = await prepareModel(bytes, format, path, localModelResource);
  try {
    const gltf = await new GLTFLoader(manager).parseAsync(assets.data, "");
    return {
      model: gltf.scene,
      dispose: () => disposeModel(gltf.scenes),
    };
  } finally {
    assets.release();
  }
}

export function ModelReading({
  source,
  name,
  path,
}: {
  source: string;
  name: string;
  path: string;
}) {
  const { t } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const fit = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | ModelFailure>("loading");
  const [materialsIgnored, setMaterialsIgnored] = useState(false);
  const format = path.split(".").pop()?.toLowerCase() ?? "";

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let active = true;
    let renderer: WebGLRenderer | undefined;
    let controls: OrbitControls | undefined;
    let model: Object3D | undefined;
    let dispose: (() => void) | undefined;
    let observer: ResizeObserver | undefined;
    setStatus("loading");
    setMaterialsIgnored(false);
    const release = () => {
      observer?.disconnect();
      controls?.dispose();
      dispose?.();
      dispose = undefined;
      model = undefined;
      renderer?.dispose();
      renderer?.forceContextLoss();
      renderer = undefined;
      fit.current = null;
      element.replaceChildren();
    };
    void (async () => {
      try {
        if (source.length > Math.ceil((MODEL_BYTE_LIMIT * 4) / 3) + 256)
          throw new ModelError("modelTooLarge");
        const bytes = sourceBytes(source);
        const info = inspectModel(bytes, format);
        const loaded = await loadModel(bytes, format, path);
        if (!active) {
          loaded.dispose();
          return;
        }
        model = loaded.model;
        dispose = loaded.dispose;
        let vertices = 0;
        let texturePixels = 0;
        const textures = new Set<Texture>();
        model.traverse((object) => {
          const mesh = object as Mesh;
          vertices += mesh.geometry?.getAttribute("position")?.count ?? 0;
          if (vertices > MODEL_VERTEX_LIMIT) throw new ModelError("modelTooLarge");
          const materials = Array.isArray(mesh.material)
            ? mesh.material
            : mesh.material
              ? [mesh.material]
              : [];
          for (const material of materials)
            for (const value of Object.values(material)) {
              if (!(value instanceof Texture) || textures.has(value)) continue;
              textures.add(value);
              const image = value.source?.data;
              const pixels = (image?.width ?? 0) * (image?.height ?? 0);
              texturePixels += pixels;
              if (pixels > 16_777_216 || texturePixels > 33_554_432)
                throw new ModelError("modelTooLarge");
            }
        });
        const bounds = new Box3().setFromObject(model);
        const center = bounds.getCenter(new Vector3());
        const radius = bounds.getSize(new Vector3()).length() / 2;
        if (
          !vertices ||
          bounds.isEmpty() ||
          !Number.isFinite(radius) ||
          radius <= 0 ||
          ![center.x, center.y, center.z].every(Number.isFinite)
        )
          throw new ModelError("modelEmpty");
        const scene = new Scene();
        scene.background = new Color(0x20252d);
        scene.add(model, new HemisphereLight(0xffffff, 0x566173, 2));
        const light = new DirectionalLight(0xffffff, 3);
        light.position.set(1, 2, 3);
        scene.add(light);
        const camera = new PerspectiveCamera(45, 1, radius / 1000, radius * 1000);
        renderer = new WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.domElement.setAttribute("aria-label", name);
        renderer.domElement.setAttribute("role", "img");
        element.append(renderer.domElement);
        controls = new OrbitControls(camera, renderer.domElement);
        controls.minDistance = radius / 100;
        controls.maxDistance = radius * 100;
        const render = () => {
          if (active && renderer) renderer.render(scene, camera);
        };
        controls.addEventListener("change", render);
        const resize = () => {
          if (!renderer) return;
          const width = Math.max(element.clientWidth, 1);
          const height = Math.max(element.clientHeight, 1);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          renderer.setSize(width, height);
          render();
        };
        fit.current = () => {
          const halfFov = Math.atan(
            Math.tan((camera.fov * Math.PI) / 360) * Math.min(camera.aspect, 1),
          );
          camera.position
            .copy(center)
            .add(
              new Vector3(1, 0.7, 1)
                .normalize()
                .multiplyScalar((radius / Math.sin(halfFov)) * 1.15),
            );
          controls?.target.copy(center);
          controls?.update();
          render();
        };
        resize();
        fit.current();
        observer = new ResizeObserver(resize);
        observer.observe(element);
        setMaterialsIgnored(info.materialsIgnored);
        setStatus("ready");
      } catch (error) {
        if (!active) return;
        release();
        setStatus(error instanceof ModelError ? error.reason : "modelFailed");
      }
    })();
    return () => {
      active = false;
      release();
    };
  }, [source, format, name, path]);

  return (
    <div className="model-reading nodrag nopan nowheel">
      <div className="file-preview__document-tools">
        <span>{format.toUpperCase()}</span>
        <button type="button" disabled={status !== "ready"} onClick={() => fit.current?.()}>
          {t("filePreview.fitView")}
        </button>
      </div>
      {status !== "ready" && (
        <p
          className="file-preview__document-status"
          role={status === "loading" ? "status" : "alert"}
        >
          {t(`filePreview.${status}`)}
        </p>
      )}
      {materialsIgnored && (
        <p className="model-reading__note">{t("filePreview.modelMaterialsIgnored")}</p>
      )}
      <div className="model-reading__viewport" ref={host} />
      {status === "ready" && (
        <p className="model-reading__note">{t("filePreview.modelControls")}</p>
      )}
    </div>
  );
}
