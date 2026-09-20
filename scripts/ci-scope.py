"""Say which halves of Build a set of changed paths has to run.

Reads NUL-separated paths on stdin and writes three `name=true|false` lines:

  front   the frontend checks, and the pages built on their own when nothing
          native is going to build them
  rust    fmt, clippy and the workspace tests
  native  the three platform bundles

A path nobody has named here runs everything. The lists below are the paths
known not to reach a half, never the ones known to reach it, so a new file is
built natively until somebody says it does not have to be.

`--all` skips the reading: a tag, a manual run, or a push whose base is gone.
"""

import json
import sys
from pathlib import Path


CONTRACT = json.loads((Path(__file__).parent / "shell-contract.json").read_text())
# What the shell-contract hash reads is compiled into the program or decides
# whether it is replaced, so none of it is only the pages' -- src/shell included.
CONTRACT_FILES = frozenset(CONTRACT["files"])

EVERYTHING = frozenset(("front", "rust", "native"))
FRONT = frozenset(("front",))
RUST = frozenset(("rust",))
NOTHING = frozenset()

# Built by workflows of their own, or never built at all. The release policy
# and the installers' key are checked by a job that runs whatever is said here.
UNBUILT_DIRECTORIES = (
    "docs/",
    "setup/",
    "scratch/",
    "bench-mark/",
    ".agents/",
    ".githooks/",
)
UNBUILT_FILES = frozenset(
    (
        ".gitignore",
        "Taskfile.yml",
        ".github/workflows/setup.yml",
        ".github/workflows/e2e.yml",
        ".github/workflows/release.yml",
        "scripts/release.py",
        "scripts/ci-scope.py",
        "scripts/install.sh",
        "scripts/install.ps1",
    )
)
# The pages and what checks them. `vite build` is the whole of what turns these
# into a release, and it is the same on every platform.
FRONT_DIRECTORIES = ("src/", "public/", "tests/")
FRONT_FILES = frozenset(
    (
        "front.html",
        "tsconfig.json",
        "biome.json",
        "scripts/dev-port.mjs",
        "scripts/update-manifest.mjs",
    )
)
SHIPPED = ("src/", "public/", "assets/", "src-tauri/")


def rust_test(path):
    return path.startswith("src-tauri/") and (
        "/tests/" in path or path.endswith("/tests.rs")
    )


def scope(path):
    if path in CONTRACT_FILES:
        return EVERYTHING
    if path in UNBUILT_FILES or path.startswith(UNBUILT_DIRECTORIES):
        return NOTHING
    if path.endswith(".md") and not path.startswith(SHIPPED):
        return NOTHING
    if path.endswith(".py") and path.startswith("tests/"):
        return NOTHING
    if path in FRONT_FILES or path.startswith(FRONT_DIRECTORIES):
        return FRONT
    # Tests are compiled by `cargo test` and by nothing a bundle is made from.
    if rust_test(path):
        return RUST
    return EVERYTHING


def scopes(paths):
    found = set()
    for path in filter(None, paths):
        found |= scope(path)
    return found


def main():
    if sys.argv[1:] == ["--all"]:
        found = EVERYTHING
    elif sys.argv[1:]:
        sys.exit("usage: ci-scope.py [--all] < NUL-separated paths")
    else:
        found = scopes(sys.stdin.read().split("\0"))
    for name in sorted(EVERYTHING):
        print(f"{name}={'true' if name in found else 'false'}")


if __name__ == "__main__":
    main()
