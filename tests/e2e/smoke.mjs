import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { waitFor } from "./runtime.mjs";

/** All actions enter through WebDriver input; Git reads independently verify the backend. */
export async function smoke(browser, repository, step) {
  const git = (...args) =>
    execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
  const click = async (selector) => {
    const element = await browser.$(selector);
    await element.waitForDisplayed({ timeout: 20000 });
    await element.click();
  };

  await step("アプリを起動し、フォルダー一覧を開く", async () => {
    await click('[aria-label="Expand root folders"]');
    await click('#folder-sidebar [aria-label="Add"]');
    const input = await browser.$('input[aria-label="Path, e.g. ~/repo"]');
    await input.setValue(repository);
    await browser.keys("Enter");
    await browser.$('#folder-sidebar [aria-label="Graph"]').waitForDisplayed();
  });

  await step("実リポジトリのGitグラフを表示する", async () => {
    await click('#folder-sidebar [aria-label="Graph"]');
    await browser.$('[data-branch="main"]').waitForDisplayed();
    assert.equal(git("log", "-1", "--format=%s"), "Initial E2E commit");
  });

  await step("画面からターミナルを開く", async () => {
    await click('[data-branch="main"] .head__cli');
    await browser.$(".xterm-helper-textarea").waitForExist({ timeout: 20000 });
    await click(".xterm-screen");
  });

  await step("PTYでファイルを作成し、Gitコミットとブランチを作る", async () => {
    const command =
      "printf 'Created through the real terminal\\n' > terminal-proof.txt && git add terminal-proof.txt && git commit -m 'Terminal E2E commit' && git branch e2e-proof && printf '\\nE2E_SUCCESS\\n'";
    // keys(string) holds all characters down together. WebKit treats repeated
    // letters as held keys; type distinct down/up pairs as a person would.
    await browser.performActions([
      {
        type: "key",
        id: "terminal-keyboard",
        actions: [...command].flatMap((value) => [
          { type: "keyDown", value },
          { type: "keyUp", value },
          { type: "pause", duration: 20 },
        ]),
      },
    ]);
    await browser.keys("Enter");
    await waitFor(
      () => git("log", "-1", "--format=%s") === "Terminal E2E commit",
      "terminal command committed the file",
    );
    await waitFor(() => git("branch", "--list", "e2e-proof") === "e2e-proof", "branch was created");
    assert.equal(
      readFileSync(join(repository, "terminal-proof.txt"), "utf8"),
      "Created through the real terminal\n",
    );
    assert.equal(git("show", "HEAD:terminal-proof.txt"), "Created through the real terminal");
    assert.equal(git("status", "--porcelain"), "");
  });

  await step("Rustの変更監視を通じ、新しいブランチがグラフに反映される", async () => {
    await browser.$('[data-branch="e2e-proof"]').waitForDisplayed({ timeout: 30000 });
  });

  await step("ファイル一覧に戻り、作成したファイルをプレビューする", async () => {
    // End the real shell so the file preview has the full canvas to be read in.
    await click(".xterm-screen");
    await browser.keys("exit");
    await browser.keys("Enter");
    await browser.$("aside").waitForDisplayed({ reverse: true });
    await click('[data-branch="main"] .head__ring');
    const file = await browser.$("#folder-sidebar").$("p=terminal-proof.txt");
    await file.waitForDisplayed();
    await file.doubleClick();
    await browser.waitUntil(
      async () => (await browser.$("body").getText()).includes("Created through the real terminal"),
      { timeout: 20000, timeoutMsg: "file preview did not display the saved content" },
    );
    assert.ok(existsSync(join(repository, "terminal-proof.txt")));
  });
}
