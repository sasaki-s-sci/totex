import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { build } from "vite";
import { compileViews, splitViews } from "../scripts/ephemeral-build.mjs";

test("production view manifests retain every stylesheet needed by the graph", async () => {
  const { output } = await build({
    root: fileURLToPath(new URL("..", import.meta.url)),
    logLevel: "silent",
    build: { write: false },
  });
  const manifest = JSON.parse(output.find((asset) => asset.fileName === "ephemeral.json").source);
  const styles = output.filter((asset) => asset.fileName.endsWith(".css"));
  assert.ok(styles.length > 0);
  assert.deepEqual(manifest.styles.toSorted(), styles.map((asset) => asset.fileName).toSorted());
  assert.ok(styles.some((asset) => String(asset.source).includes(".graph")));
});

function split(text) {
  const name = "/views.tsx";
  const host = ts.createCompilerHost({});
  const original = host.getSourceFile;
  host.getSourceFile = (path, ...args) =>
    path === name
      ? ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
      : original(path, ...args);
  const program = ts.createProgram([name], { jsx: ts.JsxEmit.ReactJSX }, host);
  return splitViews(program.getSourceFile(name), program.getTypeChecker(), "views.tsx");
}

test("view-only changes leave every hook, effect and component identity in the same host", () => {
  const text = `import { useState, useEffect } from 'react';
    export function Panel() { const [count, setCount] = useState(0);
      useEffect(() => subscribe(), []);
      return <button onClick={() => setCount(count + 1)}>Old {count}</button>; }`;
  const first = split(text);
  const next = split(text.replace("Old", "New"));
  assert.equal(first.code, next.code);
  assert.notEqual(compileViews(first.views), compileViews(next.views));
  assert.match(first.code, /useState\(0\)/);
  assert.match(first.code, /useEffect\(/);
  assert.deepEqual(first.views[0].keys, ["count", "setCount"]);
  assert.notEqual(first.code, split(text.replace("useState(0)", "useState(1)")).code);
});

test("captures imported components, shorthand values and outer callbacks without capturing inner locals", () => {
  const { views } = split(`import { Box } from 'ui';
    const label = 'x'; const items = [1]; const onPick = () => {};
    export function Panel() { return <Box title={label} data={{label}}>
      {items.map(item => <button onClick={() => onPick(item)}>{item}</button>)}
    </Box>; }`);
  assert.equal(views.length, 1);
  assert.deepEqual(views[0].keys, ["Box", "items", "label", "onPick"]);
  assert.doesNotMatch(compileViews(views), /from "react/);
});

test("adding a new host binding or view slot requires another persistent runtime", () => {
  const before = split(`const a=1,b=2; export const Panel = () => <div>{a}</div>;`);
  const after = split(`const a=1,b=2; export const Panel = () => <div>{b}</div>;`);
  assert.notEqual(before.code, after.code);
});

test("list keys are kept on the persistent rendering slot", () => {
  const { code } = split(
    `const items = [{id: 'a'}]; export const list = items.map(item => <div key={item.id}>{item.id}</div>);`,
  );
  assert.match(code, /__renderEphemeral\("views.tsx:0", \{item\}, item.id\)/);
});

test("class instances and their error boundaries stay in the persistent host", () => {
  const { code, views } = split(
    `class Boundary { render() { return <p>{this.props.message}</p>; } }`,
  );
  assert.equal(views.length, 0);
  assert.match(code, /this.props.message/);
});

test("hooks cannot enter a replaceable rendering expression", () => {
  assert.throws(
    () =>
      split(
        `import { useState } from 'react'; export const View = () => <div>{useState(0)[0]}</div>;`,
      ),
    /hooks belong in the persistent controller/,
  );
});
