import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import ts from "typescript";

const identity = "virtual:ephemeral-identity";
const shellIdentity = "virtual:shell-identity";
const runtime = "/src/ephemeral/runtime";
const hash = (text) => createHash("sha256").update(text).digest("hex");

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = resolve(directory, entry.name).replaceAll("\\", "/");
      return entry.isDirectory() ? filesUnder(path) : [path];
    })
    .sort();
}

/** Extract only JSX expressions. Hooks, stores, effects and component identities stay in the host. */
export function splitViews(source, checker, name) {
  const edits = [];
  const views = [];
  const visit = (node) => {
    // Class controllers use instance state and lifecycle methods; keep them entirely in the host.
    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) return;
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      const bindings = new Set();
      const capture = (child) => {
        if (ts.isCallExpression(child)) {
          const callee = ts.isPropertyAccessExpression(child.expression)
            ? child.expression.name
            : child.expression;
          if (ts.isIdentifier(callee) && /^(use[A-Z]|use$)/.test(callee.text)) {
            throw new Error(
              `${name}: hooks belong in the persistent controller, outside JSX expressions`,
            );
          }
        }
        if (ts.isTypeNode(child)) return;
        if (ts.isIdentifier(child)) {
          const parent = child.parent;
          const property =
            (ts.isPropertyAccessExpression(parent) && parent.name === child) ||
            (ts.isPropertyAssignment(parent) && parent.name === child) ||
            ts.isJsxAttribute(parent);
          if (!property) {
            const symbol = ts.isShorthandPropertyAssignment(parent)
              ? checker.getShorthandAssignmentValueSymbol(parent)
              : checker.getSymbolAtLocation(child);
            if (
              symbol?.declarations?.some(
                (declaration) =>
                  declaration.getSourceFile() === source &&
                  (declaration.pos < node.pos || declaration.end > node.end),
              )
            ) {
              bindings.add(child.text);
            }
          }
        }
        ts.forEachChild(child, capture);
      };
      capture(node);
      const keys = [...bindings].sort();
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const keyAttribute = opening.attributes?.properties.find(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.text === "key",
      );
      const initializer = keyAttribute?.initializer;
      const key =
        initializer &&
        (ts.isJsxExpression(initializer)
          ? initializer.expression?.getText(source)
          : initializer.getText(source));
      const id = `${name}:${views.length}`;
      views.push({ id, keys, expression: node.getText(source) });
      edits.push({
        start: node.getStart(source),
        end: node.end,
        code: `__renderEphemeral(${JSON.stringify(id)}, {${keys.join(",")}}${key ? `, ${key}` : ""})`,
      });
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  let code = source.text;
  for (const edit of edits.reverse())
    code = code.slice(0, edit.start) + edit.code + code.slice(edit.end);
  if (views.length)
    code = `import { renderEphemeral as __renderEphemeral } from ${JSON.stringify(runtime)};\n${code}`;
  return { code, views };
}

export function compileViews(views) {
  const source = `export const views = {${views
    .map(
      ({ id, keys, expression }) =>
        `${JSON.stringify(id)}: ({${keys.join(",")}}) => (${expression})`,
    )
    .join(",\n")}};`;
  return ts
    .transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        removeComments: true,
      },
      fileName: "views.tsx",
    })
    .outputText.replace(
      /import \{([^}]+)\} from "react\/jsx-runtime";/g,
      (_, names) => `const {${names.replace(/\bas\b/g, ":")}} = globalThis.__TOTEX_VIEWS__.jsx;`,
    );
}

/** The same host may load many view releases; any change outside the view boundary changes its identity. */
export function prepareViews(root) {
  const sources = filesUnder(resolve(root, "src"));
  const program = ts.createProgram(
    sources.filter((path) => /\.tsx?$/.test(path)),
    {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      skipLibCheck: true,
      allowSyntheticDefaultImports: true,
    },
  );
  const checker = program.getTypeChecker();
  const modules = new Map();
  const views = [];
  const parts = [];
  for (const path of sources) {
    const name = relative(root, path).replaceAll("\\", "/");
    if (/\.css$/.test(path)) continue;
    const source = program.getSourceFile(path);
    if (
      source &&
      !name.startsWith("src/ephemeral/") &&
      !name.startsWith("src/shell/") &&
      name !== "src/main.tsx"
    ) {
      const split = splitViews(source, checker, name);
      modules.set(path, split.code);
      views.push(...split.views);
      parts.push(name, split.code.replaceAll("\r\n", "\n"));
    } else {
      parts.push(
        name,
        /\.(tsx?|json)$/.test(path)
          ? readFileSync(path, "utf8").replaceAll("\r\n", "\n")
          : readFileSync(path).toString("base64"),
      );
    }
  }
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const { version, ...configuration } = pkg;
  parts.push(JSON.stringify(configuration));
  // Native commands and dependencies belong to the host too. Release numbers do not define compatibility.
  for (const path of [
    ...filesUnder(resolve(root, "src-tauri/src")),
    ...filesUnder(resolve(root, "src-tauri/host/src")),
    ...filesUnder(resolve(root, "src-tauri/persistent/src")),
    resolve(root, "pnpm-lock.yaml"),
    resolve(root, "scripts/ephemeral-build.mjs"),
  ]) {
    const name = relative(root, path).replaceAll("\\", "/");
    if (name.includes("/tests/") || name.endsWith("/tests.rs")) continue;
    parts.push(name, readFileSync(path, "utf8").replaceAll("\r\n", "\n"));
  }
  for (const name of [
    "src-tauri/Cargo.toml",
    "src-tauri/host/Cargo.toml",
    "src-tauri/persistent/Cargo.toml",
  ]) {
    const text = readFileSync(resolve(root, name), "utf8").replaceAll("\r\n", "\n");
    parts.push(name, text.replace(/(\[package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/, '$1"release"'));
  }
  const cargoLock = readFileSync(resolve(root, "src-tauri/Cargo.lock"), "utf8").replaceAll(
    "\r\n",
    "\n",
  );
  parts.push(
    cargoLock.replace(/(name = "(?:totex|totex-persistent)"\nversion = )"[^"]+"/g, '$1"release"'),
  );
  const config = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
  delete config.version;
  parts.push(
    readFileSync(resolve(root, "index.html"), "utf8").replaceAll("\r\n", "\n"),
    readFileSync(resolve(root, "front.html"), "utf8").replaceAll("\r\n", "\n"),
    readFileSync(resolve(root, "vite.config.ts"), "utf8").replaceAll("\r\n", "\n"),
  );
  parts.push(
    JSON.stringify(config),
    readFileSync(resolve(root, "src-tauri/build.rs"), "utf8").replaceAll("\r\n", "\n"),
  );
  return {
    contract: shellContract(root),
    viewsContract: hash(parts.join("\n")),
    version,
    modules,
    views,
  };
}

/** Only the native host, shell and its IPC dependency define full-front compatibility. */
export function shellContract(root) {
  const paths = [
    ...filesUnder(resolve(root, "src-tauri/src")),
    ...filesUnder(resolve(root, "src-tauri/host/src")),
    ...filesUnder(resolve(root, "src-tauri/persistent/src")),
    // The bridge, handoff hooks and focus helpers run in the replaceable frontend.
    resolve(root, "src/shell/main.ts"),
    resolve(root, "src/shell/protocol.ts"),
    ...[
      "index.html",
      "vite.config.ts",
      "scripts/ephemeral-build.mjs",
      "src-tauri/build.rs",
      "src-tauri/Cargo.toml",
      "src-tauri/host/Cargo.toml",
      "src-tauri/persistent/Cargo.toml",
      "src-tauri/Cargo.lock",
    ].map((path) => resolve(root, path)),
  ];
  const parts = [];
  for (const path of paths.sort()) {
    const name = relative(root, path).replaceAll("\\", "/");
    if (name.includes("/tests/") || name.endsWith("/tests.rs")) continue;
    let text = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
    if (name.endsWith("Cargo.toml"))
      text = text.replace(/(\[package\][\s\S]*?\nversion\s*=\s*)"[^"]+"/, '$1"release"');
    if (name.endsWith("Cargo.lock"))
      text = text.replace(
        /(name = "(?:totex|totex-persistent)"\nversion = )"[^"]+"/g,
        '$1"release"',
      );
    parts.push(name, text);
  }
  const config = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
  delete config.version;
  const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
  const api = JSON.parse(
    readFileSync(resolve(root, "node_modules/@tauri-apps/api/package.json"), "utf8"),
  );
  parts.push(JSON.stringify(config), String(pkg.frontContract), api.version);
  return hash(parts.join("\n"));
}

export default function ephemeralBuild() {
  let root;
  let built;
  let production = false;
  return {
    name: "totex-ephemeral",
    enforce: "pre",
    // Lazy host chunks must never inject an older stylesheet after a view swap.
    config() {
      return { build: { cssCodeSplit: false } };
    },
    configResolved(config) {
      root = config.root;
      production = config.command === "build";
    },
    buildStart() {
      if (production) built = prepareViews(root);
    },
    resolveId(id) {
      if (id === identity || id === shellIdentity) return `\0${id}`;
    },
    load(id) {
      if (id === `\0${shellIdentity}`)
        return `export const contract = ${JSON.stringify(built?.contract ?? "development")};`;
      if (id === `\0${identity}`)
        return `export const contract = ${JSON.stringify(built?.viewsContract ?? "development")};`;
    },
    transform(_code, id) {
      const replacement = built?.modules.get(id);
      if (replacement !== undefined) return { code: replacement, map: null };
    },
    generateBundle: {
      // Vite emits the shared stylesheet during generateBundle. Read the bundle after it.
      order: "post",
      handler(_options, bundle) {
        if (!built) return;
        // The outer document does not use the frontend's shared stylesheet.
        const shell = bundle["index.html"];
        if (shell?.type === "asset")
          shell.source = String(shell.source).replace(/\s*<link\b[^>]*rel="stylesheet"[^>]*>/g, "");
        const code = compileViews(built.views);
        const entry = `assets/ephemeral-${hash(code).slice(0, 16)}.js`;
        this.emitFile({ type: "asset", fileName: entry, source: code });
        this.emitFile({
          type: "asset",
          fileName: "ephemeral.json",
          source: JSON.stringify({
            schema: 2,
            version: built.version,
            contract: built.contract,
            viewsContract: built.viewsContract,
            entry,
            styles: Object.keys(bundle).filter((name) => name.endsWith(".css")),
            views: built.views.map(({ id }) => id),
          }),
        });
      },
    },
  };
}
