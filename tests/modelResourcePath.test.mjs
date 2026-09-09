import assert from "node:assert/strict";
import { test } from "node:test";
import { modelResourcePath } from "../src/lib/modelResourcePath.ts";

test("glTF resources retain Unix, Windows and WSL model directories", () => {
  assert.equal(
    modelResourcePath("/models/scene.gltf", "textures/a%20b.png"),
    "/models/textures/a b.png",
  );
  assert.equal(modelResourcePath("/scene.gltf", "./mesh.bin"), "/mesh.bin");
  assert.equal(modelResourcePath("C:\\scene.gltf", "mesh.bin"), "C:\\mesh.bin");
  assert.equal(
    modelResourcePath("\\\\wsl.localhost\\Ubuntu\\models\\scene.gltf", "mesh.bin"),
    "\\\\wsl.localhost\\Ubuntu\\models\\mesh.bin",
  );
  assert.equal(modelResourcePath("/models/scene.gltf", "textures/../mesh.bin"), "/models/mesh.bin");
  assert.equal(
    modelResourcePath("C:\\models\\scene.gltf", "textures/albedo%23base.png"),
    "C:\\models\\textures\\albedo#base.png",
  );
  assert.equal(
    modelResourcePath(
      "\\\\wsl.localhost\\Ubuntu\\models\\scene.gltf",
      "textures/albedo%3Fbase.png",
    ),
    "\\\\wsl.localhost\\Ubuntu\\models\\textures\\albedo?base.png",
  );
  assert.equal(
    modelResourcePath("/models/scene.gltf", "textures/100%25.png"),
    "/models/textures/100%.png",
  );
});

test("model resources reject network URLs, absolute paths and directory escape", () => {
  for (const uri of [
    "../secret",
    "%2e%2e/secret",
    "a/../../secret",
    "/etc/passwd",
    "\\\\host\\share",
    "https://host/file",
    "file:///tmp/file",
    "C:\\secret",
    "mesh.bin?x",
    "mesh.bin#x",
    "a%00b",
    "%zz",
    "",
  ]) {
    assert.throws(() => modelResourcePath("/models/scene.gltf", uri));
  }
});
