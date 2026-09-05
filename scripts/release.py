"""Plan app releases from Git snapshots; write version files only on request.

Python 3.11+ and Git are the only dependencies. Planning never changes the tree.
"""

import argparse
import copy
import json
import re
import subprocess
import tomllib
from pathlib import Path


VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\Z")
MANIFESTS = (
    "package.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/persistent/Cargo.toml",
)
LOCK = "src-tauri/Cargo.lock"
PERSISTENT = "src-tauri/persistent/"
HOST = "src-tauri/host/"


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True)


class Tree:
    def __init__(self, root, ref):
        self.root = root
        self.ref = ref
        self.files = set(
            git(root, "ls-tree", "-r", "--name-only", "-z", ref).split("\0")
        )

    def text(self, path):
        return (
            git(self.root, "show", f"{self.ref}:{path}") if path in self.files else ""
        )

    def toml(self, path):
        return tomllib.loads(self.text(path))


def version_of(read):
    versions = []
    for path in MANIFESTS:
        text = read(path)
        value = (
            json.loads(text)["version"]
            if path.endswith(".json")
            else tomllib.loads(text)["package"]["version"]
        )
        versions.append(value)
    if len(set(versions)) != 1 or not VERSION.fullmatch(versions[0]):
        raise ValueError(f"version files disagree or are not X.Y.Z: {versions}")
    lock = tomllib.loads(read(LOCK))["package"]
    for name in ("totex", "totex-persistent"):
        found = [p["version"] for p in lock if p["name"] == name and "source" not in p]
        if found != [versions[0]]:
            raise ValueError(f"{LOCK}: {name} does not carry {versions[0]}")
    return versions[0]


def manifest(text):
    """Ignore release numbers and development-only declarations, not features."""
    value = tomllib.loads(text)
    value.get("package", {}).pop("version", None)
    value.pop("dev-dependencies", None)
    for target in value.get("target", {}).values():
        target.pop("dev-dependencies", None)
    return value


def direct_dependencies(value):
    names = set()
    for section in (value, *value.get("target", {}).values()):
        for group in ("dependencies", "build-dependencies"):
            for name, spec in section.get(group, {}).items():
                names.add(spec.get("package", name) if isinstance(spec, dict) else name)
    return names


def shipped_lock(tree, name):
    """Compare only the locked dependency graph that can ship in one program.

    Cargo records dependencies for every platform. Keep them all, even when the
    release planner runs on Linux, and exclude the local crates' test roots.
    """
    packages = tree.toml(LOCK).get("package", [])
    local = {}
    for folder in ("src-tauri/", PERSISTENT, HOST):
        value = tree.toml(folder + "Cargo.toml")
        if value:
            local[value["package"]["name"]] = direct_dependencies(value)

    def resolve(reference):
        parts = reference.split(" ", 2)
        candidates = [p for p in packages if p["name"] == parts[0]]
        if len(parts) > 1:
            candidates = [p for p in candidates if p["version"] == parts[1]]
        if len(parts) > 2:
            candidates = [
                p for p in candidates if p.get("source") == parts[2].strip("()")
            ]
        if len(candidates) != 1:
            raise ValueError(f"cannot resolve locked dependency {reference!r}")
        return candidates[0]

    if name not in local:
        return []
    pending = [resolve(name)]
    visited = {}
    while pending:
        package = pending.pop()
        key = (package["name"], package["version"], package.get("source", ""))
        if key in visited:
            continue
        value = copy.deepcopy(package)
        dependencies = value.get("dependencies", [])
        if package["name"] in local and "source" not in package:
            dependencies = [
                d for d in dependencies if d.split()[0] in local[package["name"]]
            ]
            value["version"] = "local"
        value["dependencies"] = sorted(dependencies)
        visited[key] = value
        pending.extend(resolve(d) for d in dependencies)
    return sorted(
        visited.values(), key=lambda p: (p["name"], p["version"], p.get("source", ""))
    )


def test_or_doc(path):
    parts = Path(path).parts
    shipped_document = path.startswith(
        (
            "src/",
            "public/",
            "assets/",
            "src-tauri/src/",
            PERSISTENT + "src/",
            HOST + "src/",
        )
    )
    return (
        "tests" in parts
        or "__tests__" in parts
        or path.endswith(
            ("/tests.rs", ".test.ts", ".test.tsx", ".spec.ts", ".spec.tsx")
        )
        or (path.endswith(".md") and not shipped_document)
        or path.startswith(("docs/", "setup/", "scratch/", "bench-mark/"))
    )


def classify(before, after):
    persistent, ephemeral = [], []
    paths = git(
        after.root, "diff", "--name-only", "--no-renames", "-z", before.ref, after.ref
    ).split("\0")
    for path in filter(None, paths):
        if test_or_doc(path):
            continue
        old, new = before.text(path), after.text(path)
        if path == LOCK:
            if shipped_lock(before, "totex-persistent") != shipped_lock(
                after, "totex-persistent"
            ):
                persistent.append(path)
            elif shipped_lock(before, "totex") != shipped_lock(after, "totex"):
                ephemeral.append(path)
        elif path in (PERSISTENT + "Cargo.toml", HOST + "Cargo.toml"):
            if manifest(old) != manifest(new):
                persistent.append(path)
        elif path == "src-tauri/Cargo.toml":
            left, right = manifest(old), manifest(new)
            if any(
                left.get(key) != right.get(key)
                for key in ("workspace", "profile", "patch", "replace")
            ):
                persistent.append(path)
            elif left != right:
                ephemeral.append(path)
        elif path.startswith((PERSISTENT, HOST)):
            # talk.rs is linked into the window; the server never calls it.
            (ephemeral if path == PERSISTENT + "src/talk.rs" else persistent).append(
                path
            )
        elif path.startswith((".cargo/", "src-tauri/.cargo/")) or path in (
            "rust-toolchain",
            "rust-toolchain.toml",
            "scripts/persistent-sidecar.mjs",
            ".github/workflows/build.yml",
        ):
            persistent.append(path)
        elif path == "mise.toml":
            left, right = (
                tomllib.loads(old).get("tools", {}),
                tomllib.loads(new).get("tools", {}),
            )
            if left.get("rust") != right.get("rust"):
                persistent.append(path)
            elif any(left.get(key) != right.get(key) for key in ("node", "pnpm")):
                ephemeral.append(path)
        elif path in ("package.json", "src-tauri/tauri.conf.json"):
            left, right = json.loads(old), json.loads(new)
            for value in (left, right):
                value.pop("version", None)
                if path == "package.json":
                    value.get("scripts", {}).pop("test", None)
            if left != right:
                ephemeral.append(path)
        elif path.startswith(("src/", "src-tauri/", "assets/", "public/")) or path in (
            "index.html",
            "vite.config.ts",
            "tsconfig.json",
            "pnpm-lock.yaml",
            "scripts/install.sh",
            "scripts/install.ps1",
            "scripts/update-manifest.mjs",
        ):
            ephemeral.append(path)
    return persistent, ephemeral


def plan(root, published, mode="auto"):
    if mode not in ("auto", "major"):
        raise ValueError("release mode must be auto or major")
    head = Tree(root, "HEAD")
    current = version_of(head.text)
    tags = [
        tag
        for tag in git(root, "tag", "--merged", "HEAD").splitlines()
        if tag.startswith("v") and VERSION.fullmatch(tag[1:])
    ]
    previous = max(
        tags, key=lambda tag: tuple(map(int, tag[1:].split("."))), default=""
    )
    result = {
        "action": "none",
        "from": current,
        "to": current,
        "tag": "",
        "previous": previous,
        "part": "",
        "sha": git(root, "rev-parse", "HEAD").strip(),
    }
    if previous:
        if previous != f"v{current}":
            raise ValueError(
                f"main carries {current}, but its newest release tag is {previous}; do not bump versions by hand"
            )
        if version_of(Tree(root, previous).text) != previous[1:]:
            raise ValueError(f"{previous} does not name the version in its tree")
        if previous not in published:
            if mode == "major":
                raise ValueError(
                    f"resume {previous} in auto mode before requesting a new major"
                )
            return {
                **result,
                "action": "build",
                "tag": previous,
                "reason": "resume unpublished tag",
            }
        persistent, ephemeral = classify(Tree(root, previous), head)
    else:
        # An existing codebase adopting automation starts on a fresh line.
        persistent, ephemeral = ["first app release"], []
    part = (
        "major"
        if mode == "major"
        else "minor"
        if persistent
        else "patch"
        if ephemeral
        else ""
    )
    if not part:
        return {**result, "reason": "no shipped changes"}
    major, minor, patch = map(int, current.split("."))
    next_version = {
        "major": f"{major + 1}.0.0",
        "minor": f"{major}.{minor + 1}.0",
        "patch": f"{major}.{minor}.{patch + 1}",
    }[part]
    tag = f"v{next_version}"
    if tag in git(root, "tag", "--list").splitlines():
        raise ValueError(f"{tag} already exists; tags are never overwritten")
    return {
        **result,
        "action": "cut",
        "part": part,
        "to": next_version,
        "tag": tag,
        "reason": ", ".join(persistent or ephemeral)
        if mode == "auto"
        else "developer milestone",
    }


def bump(root, version):
    if not VERSION.fullmatch(version):
        raise ValueError("version must be X.Y.Z")

    def read(path):
        return (Path(root) / path).read_text()

    version_of(read)
    changed = {}
    for path in MANIFESTS:
        text = read(path)
        pattern = (
            r'(?m)^(\s*"version"\s*:\s*")[^"]+(".*)$'
            if path.endswith(".json")
            else r'(?m)^(version\s*=\s*")[^"]+(".*)$'
        )
        updated, count = re.subn(
            pattern, lambda m: f"{m[1]}{version}{m[2]}", text, count=1
        )
        if count != 1:
            raise ValueError(f"cannot write version in {path}")
        changed[path] = updated
    pattern = r'(?m)^(name = "(?:totex|totex-persistent)"\nversion = ")[^"]+(".*)$'
    changed[LOCK], count = re.subn(
        pattern, lambda m: f"{m[1]}{version}{m[2]}", read(LOCK)
    )
    if count != 2:
        raise ValueError("cannot write both local package versions in Cargo.lock")
    version_of(changed.__getitem__)
    for path, text in changed.items():
        (Path(root) / path).write_text(text)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("plan", "bump", "verify"))
    parser.add_argument("--mode", choices=("auto", "major"), default="auto")
    parser.add_argument("--published", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--version")
    args = parser.parse_args()
    if args.command == "verify":
        print(version_of(lambda path: Path(path).read_text()))
        return
    if args.command == "bump":
        if args.version is None:
            parser.error("bump requires --version")
        bump(Path.cwd(), args.version)
        return
    if args.published is None:
        parser.error("plan requires --published, a JSON list from the releases API")
    pages = json.loads(args.published.read_text())
    releases = (
        [release for page in pages for release in page]
        if pages and isinstance(pages[0], list)
        else pages
    )
    published = {
        r["tag_name"]
        for r in releases
        if not r.get("draft") and not r.get("prerelease")
    }
    result = plan(Path.cwd(), published, args.mode)
    print(json.dumps(result, indent=2))
    if args.output:
        with args.output.open("a") as output:
            for key in ("action", "from", "to", "tag", "previous", "part", "sha"):
                output.write(f"{key}={result[key]}\n")


if __name__ == "__main__":
    main()
