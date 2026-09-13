"""Release decisions against real temporary Git histories, without publishing."""

import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "release.py"
SPEC = importlib.util.spec_from_file_location("release", SCRIPT)
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="totex-release-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git("init", "-q", "-b", "main")
        # Background maintenance can outlive a commit and race with cleanup
        # of this disposable repository. Older Git uses auto GC instead.
        self.git("config", "maintenance.auto", "false")
        self.git("config", "gc.auto", "0")
        self.git("config", "user.name", "Release tests")
        self.git("config", "user.email", "tests@example.invalid")
        self.git("config", "commit.gpgsign", "false")
        self.write(
            "package.json",
            json.dumps(
                {
                    "version": "1.2.3",
                    "frontContract": 7,
                    "scripts": {},
                    "dependencies": {
                        "@tauri-apps/api": "^2.11.1",
                        "react": "^19.2.8",
                    },
                },
                indent=2,
            )
            + "\n",
        )
        self.write(
            "pnpm-lock.yaml",
            """lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      '@tauri-apps/api':
        specifier: ^2.11.1
        version: 2.11.1
      react:
        specifier: ^19.2.8
        version: 19.2.8
packages:
  '@tauri-apps/api@2.11.1': {}
  react@19.2.8: {}
""",
        )
        self.write("src-tauri/tauri.conf.json", '{\n  "version": "1.2.3"\n}\n')
        self.write(
            "src-tauri/Cargo.toml",
            """[workspace]
members = ["persistent", "host"]
[package]
name = "totex"
version = "1.2.3"
[dependencies]
totex-persistent = { path = "persistent" }
window = "1"
[dev-dependencies]
testing = "1"
""",
        )
        self.write(
            "src-tauri/persistent/Cargo.toml",
            """[package]
name = "totex-persistent"
version = "1.2.3"
[dependencies]
totex-host = { path = "../host" }
runtime = "1"
[dev-dependencies]
testing = "1"
""",
        )
        self.write(
            "src-tauri/host/Cargo.toml",
            """[package]
name = "totex-host"
version = "0.0.0"
[dependencies]
shared = "1"
""",
        )
        self.write(
            release.LOCK,
            """version = 4
[[package]]
name = "totex"
version = "1.2.3"
dependencies = ["totex-persistent", "window", "testing"]
[[package]]
name = "totex-persistent"
version = "1.2.3"
dependencies = ["totex-host", "runtime", "testing"]
[[package]]
name = "totex-host"
version = "0.0.0"
dependencies = ["shared"]
[[package]]
name = "runtime"
version = "1.0.0"
dependencies = ["leaf"]
[[package]]
name = "leaf"
version = "1.0.0"
[[package]]
name = "shared"
version = "1.0.0"
[[package]]
name = "window"
version = "1.0.0"
[[package]]
name = "testing"
version = "1.0.0"
""",
        )
        self.write("src/App.tsx", "original\n")
        self.write("src/shell/main.ts", "original\n")
        self.write("index.html", "<!doctype html><title>shell</title>\n")
        self.write("vite.config.ts", "export default {};\n")
        self.write("src-tauri/src/lib.rs", "original\n")
        self.write("src-tauri/persistent/src/main.rs", "original\n")
        self.write("src-tauri/persistent/src/talk.rs", "original\n")
        self.write("src-tauri/host/src/host/file.rs", "original\n")
        self.write(
            "mise.toml", '[tools]\nrust = { version = "1.95.0" }\nnode = "24.13.0"\n'
        )
        self.commit()
        self.git("tag", "v1.2.3")

    def git(self, *args):
        return release.git(self.root, *args)

    def write(self, path, text):
        file = self.root / path
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(text)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-qm", "fixture")

    def plan(self, mode="auto", published=None):
        return release.plan(
            self.root, {"v1.2.3"} if published is None else published, mode
        )

    def changes(self):
        """Classify against the tag directly, past the version-agreement checks."""
        return release.classify(
            release.Tree(self.root, "v1.2.3"), release.Tree(self.root, "HEAD")
        )

    def test_ephemeral_is_patch(self):
        self.write("src/App.tsx", "updated\n")
        self.commit()
        result = self.plan()
        self.assertEqual(
            (result["action"], result["part"], result["to"]), ("cut", "patch", "1.2.4")
        )

    def test_persistent_wins_over_ephemeral(self):
        self.write("src/App.tsx", "updated\n")
        self.write("src-tauri/persistent/src/main.rs", "updated\n")
        self.commit()
        self.assertEqual(self.plan()["to"], "1.3.0")

    def test_front_document_is_shipped_as_a_patch(self):
        self.write("front.html", "<!doctype html><title>front</title>\n")
        self.commit()
        self.assertEqual(self.plan()["part"], "patch")

    def test_shared_host_is_persistent(self):
        self.write("src-tauri/host/src/host/file.rs", "updated\n")
        self.commit()
        self.assertEqual(self.plan()["part"], "minor")

    def test_window_client_is_persistent(self):
        # The contract hashes every Rust source, the window client included.
        self.write("src-tauri/persistent/src/talk.rs", "updated\n")
        self.commit()
        self.assertEqual(self.plan()["part"], "minor")

    def test_native_shell_source_is_persistent(self):
        self.write("src-tauri/src/lib.rs", "updated\n")
        self.commit()
        self.assertEqual(self.plan()["part"], "minor")

    def test_shell_bridge_source_is_persistent(self):
        self.write("src/shell/main.ts", "updated\n")
        self.commit()
        self.assertEqual(self.plan()["part"], "minor")

    def test_shell_document_and_bundler_configuration_are_persistent(self):
        for path in ("index.html", "vite.config.ts"):
            with self.subTest(path=path):
                self.write(path, "updated\n")
                self.commit()
                self.assertEqual(self.plan()["part"], "minor")

    def test_window_configuration_is_persistent(self):
        self.write(
            "src-tauri/tauri.conf.json",
            '{\n  "version": "1.2.3",\n  "app": {"withGlobalTauri": true}\n}\n',
        )
        self.commit()
        self.assertEqual(self.plan()["part"], "minor")

    def test_frontend_manifest_is_patch_unless_it_carries_the_contract(self):
        original = json.loads((self.root / "package.json").read_text())
        value = dict(original, scripts={"dev": "vite"})
        self.write("package.json", json.dumps(value, indent=2) + "\n")
        self.commit()
        self.assertEqual(self.plan()["part"], "patch")
        value = dict(value, frontContract=original["frontContract"] + 1)
        self.write("package.json", json.dumps(value, indent=2) + "\n")
        self.commit()
        self.assertEqual(self.plan()["part"], "minor")

    def test_shell_dependency_decides_the_frontend_lock(self):
        original = (self.root / "pnpm-lock.yaml").read_text()
        self.write("pnpm-lock.yaml", original.replace("19.2.8", "19.3.0"))
        self.commit()
        self.assertEqual(self.plan()["part"], "patch")
        self.write(
            "pnpm-lock.yaml",
            original.replace("19.2.8", "19.3.0").replace("2.11.1", "2.12.0"),
        )
        self.commit()
        self.assertEqual(self.plan()["part"], "minor")

    def test_editing_the_contract_list_is_persistent(self):
        # The list decides which files the hash reads, so it hashes itself.
        self.write("scripts/shell-contract.json", '{"directories": [], "files": []}\n')
        self.commit()
        self.assertEqual(self.plan()["part"], "minor")

    def test_shared_build_configuration_is_persistent(self):
        self.write(".github/workflows/build.yml", "updated build\n")
        self.commit()
        self.assertEqual(self.plan()["part"], "minor")

    def test_shipped_markdown_is_app_content(self):
        self.write("public/help.md", "Updated help shown in the app\n")
        self.commit()
        self.assertEqual(self.plan()["part"], "patch")

    def test_docs_tests_workflows_and_standalone_setup_do_not_release(self):
        for path in (
            "README.md",
            "tests/test_new.py",
            "src-tauri/persistent/tests/reach.rs",
            "src-tauri/persistent/src/session/tests/mod.rs",
            "src-tauri/host/src/fs_browse/tests/operate.rs",
            "src-tauri/src/ask/tests.rs",
            "setup/src/main.rs",
            ".github/workflows/release.yml",
        ):
            self.write(path, "updated\n")
        self.commit()
        self.assertEqual(self.plan()["action"], "none")

    def test_developer_can_mark_a_major_without_source_changes(self):
        self.assertEqual(self.plan("major")["to"], "2.0.0")
        self.assertEqual(self.plan()["action"], "none")
        with self.assertRaises(ValueError):
            self.plan("patch")

    def test_cumulative_changes_include_earlier_commits(self):
        self.write("src-tauri/persistent/src/main.rs", "updated\n")
        self.commit()
        self.write("README.md", "docs\n")
        self.commit()
        self.assertEqual(self.plan()["part"], "minor")

    def test_reverted_changes_do_not_release(self):
        self.write("src/App.tsx", "updated\n")
        self.commit()
        self.write("src/App.tsx", "original\n")
        self.commit()
        self.assertEqual(self.plan()["action"], "none")

    def test_deletion_and_rename_out_of_persistent_are_minor(self):
        self.git("mv", "src-tauri/persistent/src/main.rs", "removed.txt")
        self.commit()
        self.assertEqual(self.plan()["part"], "minor")

    def test_unpublished_tag_is_resumed_without_bumping(self):
        self.write("src/App.tsx", "updated\n")
        self.commit()
        result = self.plan(published=set())
        self.assertEqual(
            (result["action"], result["tag"], result["to"]),
            ("build", "v1.2.3", "1.2.3"),
        )
        with self.assertRaisesRegex(ValueError, "auto mode"):
            self.plan("major", published=set())

    def test_bump_updates_all_carriers_and_cannot_loop(self):
        release.bump(self.root, "1.3.0")
        self.commit()
        self.assertEqual(
            release.version_of(release.Tree(self.root, "HEAD").text), "1.3.0"
        )
        self.git("tag", "v1.3.0")
        self.assertEqual(self.plan(published={"v1.2.3", "v1.3.0"})["action"], "none")
        before, after = (
            release.Tree(self.root, "v1.2.3"),
            release.Tree(self.root, "HEAD"),
        )
        self.assertEqual(release.classify(before, after), ([], []))

    def test_mismatched_versions_fail_before_writing(self):
        path = "package.json"
        self.write(path, '{"version":"9.9.9"}')
        previous = (self.root / release.LOCK).read_text()
        with self.assertRaises(ValueError):
            release.bump(self.root, "2.0.0")
        self.assertEqual((self.root / release.LOCK).read_text(), previous)
        self.commit()
        with self.assertRaises(ValueError):
            self.plan()

    def test_existing_tag_is_never_overwritten(self):
        self.git("tag", "v1.2.4")
        self.write("src/App.tsx", "updated\n")
        self.commit()
        with self.assertRaises(ValueError):
            self.plan()

    def test_non_app_tags_are_ignored(self):
        self.git("tag", "setup")
        self.git("tag", "v99.0.0-beta")
        self.write("src/App.tsx", "updated\n")
        self.commit()
        self.assertEqual(self.plan()["to"], "1.2.4")

    def test_first_release_starts_a_new_line(self):
        self.git("tag", "-d", "v1.2.3")
        self.assertEqual(self.plan()["to"], "1.3.0")

    def test_every_locked_dependency_is_part_of_the_contract(self):
        original = (self.root / release.LOCK).read_text()
        for name in ("leaf", "shared", "window", "testing"):
            with self.subTest(package=name):
                updated = original.replace(
                    f'name = "{name}"\nversion = "1.0.0"',
                    f'name = "{name}"\nversion = "1.0.1"',
                )
                self.write(release.LOCK, updated)
                self.commit()
                self.assertEqual(self.plan()["part"], "minor")

    def test_local_release_numbers_in_the_lock_are_not_a_release(self):
        original = (self.root / release.LOCK).read_text()
        self.write(release.LOCK, original.replace('"1.2.3"', '"1.2.4"'))
        self.commit()
        self.assertEqual(self.changes(), ([], []))

    def test_manifest_declarations_are_minor(self):
        for path in ("src-tauri/Cargo.toml", "src-tauri/persistent/Cargo.toml"):
            with self.subTest(path=path):
                original = (self.root / path).read_text()
                self.write(
                    path, original.replace("[dependencies]", '[dependencies]\nextra = "1"')
                )
                self.commit()
                self.assertEqual(self.plan()["part"], "minor")
                self.write(path, original)
                self.commit()

    def test_manifest_release_numbers_are_not_a_release(self):
        path = "src-tauri/persistent/Cargo.toml"
        original = (self.root / path).read_text()
        self.write(path, original.replace('version = "1.2.3"', 'version = "1.2.4"'))
        self.commit()
        self.assertEqual(self.changes(), ([], []))

    def test_rust_toolchain_is_minor_and_node_toolchain_is_patch(self):
        self.write(
            "mise.toml", '[tools]\nrust = { version = "1.95.0" }\nnode = "25.0.0"\n'
        )
        self.commit()
        self.assertEqual(self.plan()["part"], "patch")
        self.write(
            "mise.toml", '[tools]\nrust = { version = "1.96.0" }\nnode = "25.0.0"\n'
        )
        self.commit()
        self.assertEqual(self.plan()["part"], "minor")

    def test_cli_plan_is_read_only_and_writes_workflow_outputs(self):
        published = self.root / "published.json"
        published.write_text(
            json.dumps([[{"tag_name": "v1.2.3", "draft": False, "prerelease": False}]])
        )
        output = self.root / "outputs"
        result = subprocess.run(
            [
                sys.executable,
                "-B",
                str(SCRIPT),
                "plan",
                "--published",
                str(published),
                "--output",
                str(output),
            ],
            cwd=self.root,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["action"], "none")
        self.assertIn("action=none\n", output.read_text())
        self.assertEqual(self.git("diff"), "")


if __name__ == "__main__":
    unittest.main()
