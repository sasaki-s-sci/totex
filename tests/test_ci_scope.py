"""Which halves of Build a change runs, path by path."""

import importlib.util
import subprocess
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "ci-scope.py"
SPEC = importlib.util.spec_from_file_location("ci_scope", SCRIPT)
ci_scope = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ci_scope)


class ScopeTests(unittest.TestCase):
    def test_pages_alone_build_nothing_native(self):
        found = ci_scope.scopes(
            [
                "src/settings/UpdateRow.tsx",
                "src/lib/update/store.ts",
                "tests/update.test.mjs",
                "public/fonts/a.woff2",
                "biome.json",
            ]
        )
        self.assertEqual(found, {"front"})

    def test_the_shell_is_the_programs_as_much_as_the_pages(self):
        for path in ci_scope.CONTRACT_FILES:
            self.assertEqual(ci_scope.scope(path), ci_scope.EVERYTHING, path)

    def test_rust_sources_build_everything(self):
        for path in (
            "src-tauri/src/front/take.rs",
            "src-tauri/persistent/src/main.rs",
            "src-tauri/tauri.conf.json",
            "src-tauri/icons/icon.ico",
            "src-tauri/capabilities/default.json",
        ):
            self.assertEqual(ci_scope.scope(path), ci_scope.EVERYTHING, path)

    def test_rust_tests_are_checked_and_not_bundled(self):
        for path in (
            "src-tauri/src/front/tests/take.rs",
            "src-tauri/src/update/tests.rs",
            "src-tauri/persistent/tests/wire.rs",
        ):
            self.assertEqual(ci_scope.scope(path), {"rust"}, path)

    def test_what_every_half_is_built_with_builds_everything(self):
        for path in (
            "package.json",
            "pnpm-lock.yaml",
            "mise.toml",
            "assets/app-icon.svg",
            "scripts/persistent-sidecar.mjs",
            "scripts/installer-art.mjs",
            ".github/workflows/build.yml",
            ".github/actions/pnpm-cache/action.yml",
        ):
            self.assertEqual(ci_scope.scope(path), ci_scope.EVERYTHING, path)

    def test_a_path_nobody_named_builds_everything(self):
        self.assertEqual(ci_scope.scope("something/new.txt"), ci_scope.EVERYTHING)
        self.assertEqual(ci_scope.scope("new-at-the-root.toml"), ci_scope.EVERYTHING)

    def test_what_build_never_reads_builds_nothing(self):
        found = ci_scope.scopes(
            [
                "README.md",
                "docs/release.md",
                "setup/src/main.rs",
                "scripts/release.py",
                "scripts/install.sh",
                "tests/test_release.py",
                ".github/workflows/setup.yml",
                "",
            ]
        )
        self.assertEqual(found, set())

    def test_a_shipped_document_is_not_documentation(self):
        self.assertEqual(ci_scope.scope("src/help/intro.md"), {"front"})
        self.assertEqual(
            ci_scope.scope("src-tauri/src/agent/prompt.md"), ci_scope.EVERYTHING
        )

    def test_one_native_path_among_pages_builds_everything(self):
        found = ci_scope.scopes(["src/App.tsx", "src-tauri/src/lib.rs"])
        self.assertEqual(found, ci_scope.EVERYTHING)

    def run_script(self, *args, stdin=""):
        return subprocess.run(
            [sys.executable, "-B", str(SCRIPT), *args],
            input=stdin,
            capture_output=True,
            text=True,
            check=True,
        ).stdout

    def test_the_output_is_what_a_workflow_reads(self):
        self.assertEqual(
            self.run_script(stdin="src/App.tsx\0docs/a.md\0"),
            "front=true\nnative=false\nrust=false\n",
        )
        self.assertEqual(
            self.run_script("--all"), "front=true\nnative=true\nrust=true\n"
        )
        self.assertEqual(self.run_script(), "front=false\nnative=false\nrust=false\n")


if __name__ == "__main__":
    unittest.main()
