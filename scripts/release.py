"""Plan app releases from Git snapshots; write version files only on request.

The version number says what a release costs the terminals. A minor release is
exactly a release that changes the line: the CLI service (`src-tauri/persistent`)
and the host crate compiled into it, with the dependencies they lock. Taking it
replaces the service and closes every terminal. A patch release leaves the line
alone, and is one of two things: pages alone, applied live in the running shell,
or a program change -- anything else the shell contract hashes, `src-tauri/src`
included -- which is installed and the window reopened over the service that is
already running, terminals kept. Which of the two a patch is, the running app
reads off the contract hash `shellContract()` computes in
`scripts/ephemeral-build.mjs`, so it is not written into the number.

`LINE_DIRECTORIES` and `LINE_FILES` say what is on the line; the shell contract
list is read from `scripts/shell-contract.json`, the same file the hash reads,
and both sides normalise release numbers the same way, so a planned patch can
never carry a line change.

Python 3.11+ and Git are the only dependencies. Planning never changes the tree.
"""

import argparse
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
CONFIGURATION = "src-tauri/tauri.conf.json"
# The one list the shell-contract hash reads: whole directories, then single
# files. Paths live next to this script, not in the planned working tree.
CONTRACT = json.loads((Path(__file__).parent / "shell-contract.json").read_text())
CONTRACT_DIRECTORIES = tuple(d.rstrip("/") + "/" for d in CONTRACT["directories"])
CONTRACT_FILES = frozenset(CONTRACT["files"])
# What is compiled into the CLI service, which only a minor replaces. The host
# crate is here whole: the service links all of it, and a list of the modules it
# happens to use would be wrong the day one more is used.
LINE_DIRECTORIES = (PERSISTENT + "src/", HOST + "src/")
LINE_FILES = frozenset((PERSISTENT + "Cargo.toml", HOST + "Cargo.toml"))
# The lock packages the service is built from, read off the lock itself.
LINE_CRATES = ("totex-persistent", "totex-host")
# pnpm records the resolved version of the shell's IPC dependency as a key.
LOCKED_API = re.compile(r"'@tauri-apps/api@([^'\s:]+)'")


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


def lined(path):
    """True when the file is compiled into the CLI service."""
    if path in LINE_FILES:
        return True
    return path.startswith(LINE_DIRECTORIES) and not (
        "/tests/" in path or path.endswith("/tests.rs")
    )


def locked(text):
    """Every package in a Cargo lock, as `name version` -> its dependencies.

    The two local packages carry the release number, which is not a change --
    the same erasure `hashed_text` makes.
    """
    packages = {}
    for package in tomllib.loads(text).get("package", []) if text else []:
        version = package["version"]
        if package["name"] in ("totex", "totex-persistent") and "source" not in package:
            version = "release"
        packages[(package["name"], version)] = package.get("dependencies", [])
    return packages


def service_closure(packages):
    """The lock packages the CLI service is built from, transitively.

    A dependency is written as a name, or a name and version where two versions
    of one crate are locked; a name alone means the only version there is.
    """
    by_name = {}
    for name, version in packages:
        by_name.setdefault(name, []).append(version)
    closure = set()
    pending = [key for key in packages if key[0] in LINE_CRATES]
    while pending:
        key = pending.pop()
        if key in closure:
            continue
        closure.add(key)
        for dependency in packages.get(key, []):
            parts = dependency.split(" ")
            name = parts[0]
            versions = [parts[1]] if len(parts) > 1 else by_name.get(name, [])
            pending.extend((name, version) for version in versions)
    return closure


def lock_changes(old, new):
    """Which lock changes reach the service: (line changed, anything else changed)."""
    before, after = locked(old), locked(new)
    changed = set(before) ^ set(after)
    if not changed:
        return False, False
    reaching = service_closure(before) | service_closure(after)
    return bool(changed & reaching), bool(changed - reaching)


def hashed(path):
    """True when the file's bytes reach the shell-contract hash.

    The hash walks whole directories and skips Rust test sources; `test_or_doc`
    already drops those, but repeating the rule keeps the two sides aligned.
    """
    if path in CONTRACT_FILES:
        return True
    return path.startswith(CONTRACT_DIRECTORIES) and not (
        "/tests/" in path or path.endswith("/tests.rs")
    )


def hashed_text(path, text):
    """Normalise a hashed file exactly as the shell-contract hash does.

    Only the release number is erased: a Cargo manifest's own `[package]`
    version, and the two local package versions Cargo records in the lock. Every
    other byte, comments and formatting included, decides the contract.
    """
    text = text.replace("\r\n", "\n")
    if path.endswith("Cargo.toml"):
        text = re.sub(
            r'(\[package\][\s\S]*?\nversion\s*=\s*)"[^"]+"',
            r'\1"release"',
            text,
            count=1,
        )
    if path.endswith("Cargo.lock"):
        text = re.sub(
            r'(name = "(?:totex|totex-persistent)"\nversion = )"[^"]+"',
            r'\1"release"',
            text,
        )
    return text


def configuration(text):
    """The window and bundle declarations, without the release number."""
    value = json.loads(text) if text else {}
    value.pop("version", None)
    return value


def package(text):
    """The frontend manifest split into the parts the contract hash reads.

    `frontContract` and the declared Tauri API dependency enter the hash; the
    rest is frontend-only, and the release number and test command never ship.
    """
    value = json.loads(text) if text else {}
    shell = (
        value.get("frontContract"),
        value.get("dependencies", {}).get("@tauri-apps/api"),
    )
    value.pop("version", None)
    value.get("scripts", {}).pop("test", None)
    return shell, value


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
    """Split shipped changes three ways: line (minor), program and pages (patch).

    The line is what the CLI service is built from, compared through the hash's
    normalisation so a release-number bump alone is not a change. The program is
    everything else the shell contract hashes, and what rebuilds the installed
    binaries without reaching the service: it is installed, and the window
    reopened over the running service. The pages are what is applied live.
    """
    line, program, pages = [], [], []
    paths = git(
        after.root, "diff", "--name-only", "--no-renames", "-z", before.ref, after.ref
    ).split("\0")
    for path in filter(None, paths):
        if test_or_doc(path):
            continue
        old, new = before.text(path), after.text(path)
        if path == LOCK:
            # Only the packages the service is built from turn the line; the
            # rest is the program's, and a local release number is neither.
            reaching, elsewhere = lock_changes(old, new)
            if reaching:
                line.append(path)
            elif elsewhere:
                program.append(path)
        elif lined(path):
            if hashed_text(path, old) != hashed_text(path, new):
                line.append(path)
        elif path.startswith((PERSISTENT, HOST)):
            line.append(path)
        elif hashed(path):
            # A release-number bump alone leaves the contract exactly where it was.
            if hashed_text(path, old) != hashed_text(path, new):
                program.append(path)
        elif path == CONFIGURATION:
            if configuration(old) != configuration(new):
                program.append(path)
        elif path == "package.json":
            shell, frontend = package(old)
            next_shell, next_frontend = package(new)
            if shell != next_shell:
                program.append(path)
            elif frontend != next_frontend:
                pages.append(path)
        elif path == "pnpm-lock.yaml":
            if set(LOCKED_API.findall(old)) != set(LOCKED_API.findall(new)):
                program.append(path)
            else:
                pages.append(path)
        elif path.startswith((".cargo/", "src-tauri/.cargo/")) or path in (
            "rust-toolchain",
            "rust-toolchain.toml",
            "scripts/persistent-sidecar.mjs",
            ".github/workflows/build.yml",
        ):
            program.append(path)
        elif path == "mise.toml":
            left, right = (
                tomllib.loads(old).get("tools", {}),
                tomllib.loads(new).get("tools", {}),
            )
            if left.get("rust") != right.get("rust"):
                program.append(path)
            elif any(left.get(key) != right.get(key) for key in ("node", "pnpm")):
                pages.append(path)
        elif path.startswith(("src/", "src-tauri/", "assets/", "public/")) or path in (
            "front.html",
            "tsconfig.json",
            "scripts/install.sh",
            "scripts/install.ps1",
            "scripts/update-manifest.mjs",
        ):
            pages.append(path)
    return line, program, pages


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
        line, program, pages = classify(Tree(root, previous), head)
    else:
        # An existing codebase adopting automation starts on a fresh line.
        line, program, pages = ["first app release"], [], []
    part = (
        "major"
        if mode == "major"
        else "minor"
        if line
        else "patch"
        if program or pages
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
        "reason": ", ".join(line or program + pages)
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
