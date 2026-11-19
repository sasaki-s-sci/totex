import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { waitFor } from "./runtime.mjs";

/** All actions enter through WebDriver input; Git reads independently verify the backend. */
export async function smoke(browser, repository, step) {
  const repositoryRow = `#folder-sidebar [data-repo-row$=":${repository}"]`;
  const folderOffer = `#cli-sidebar .page__header .page__terminal-list .session-offer[title="${repository}"]`;
  const terminal = '#cli-sidebar [data-terminal-shown="true"]';
  const git = (...args) =>
    execFileSync("git", ["-C", repository, ...args], { encoding: "utf8" }).trim();
  const click = async (selector) => {
    const element = await browser.$(selector);
    await element.waitForDisplayed({ timeout: 20000 });
    await element.click();
  };
  const typeCommand = async (command) => {
    // WebKit treats repeated letters as held keys unless each key is released.
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
  };
  const controlKey = async (value) => {
    await browser.performActions([
      {
        type: "key",
        id: "terminal-keyboard",
        actions: [
          { type: "keyDown", value: "\uE009" },
          { type: "keyDown", value },
          { type: "keyUp", value },
          { type: "keyUp", value: "\uE009" },
        ],
      },
    ]);
  };
  const verifyPaste = async (name, expected) => {
    const relativePath = `.git/${name}`;
    const proof = join(repository, relativePath);
    // cat receives the clipboard as data, never as a shell command.
    await typeCommand(`cat > ${relativePath}`);
    await waitFor(() => existsSync(proof), "cat opened the clipboard proof file");
    await controlKey("v");
    // Allow the asynchronous native paste to reach the PTY before submitting the line.
    await browser.pause(300);
    await browser.keys("Enter");
    await waitFor(
      () => readFileSync(proof, "utf8") === `${expected}\n`,
      `${name}: clipboard text reached the real terminal`,
    );
    await controlKey("d");
  };

  await step("アプリを起動し、フォルダー一覧を開く", async () => {
    const front = await browser.$('iframe[title="totex"]');
    await front.waitForDisplayed({ timeout: 30000 });
    await browser.switchFrame(front);
    // A pane listing the repositories under the path, which is the repository itself: one row.
    await click('#folder-sidebar [aria-label="Add a folder or repositories"]');
    await click('[aria-label="Open as"] [value="repository"]');
    const input = await browser.$('input[aria-label^="Path, e.g."]');
    await input.setValue(repository);
    await browser.keys("Enter");
    await browser.$('#folder-sidebar [aria-label="Show in terminal list"]').waitForDisplayed();
  });

  await step("実リポジトリをターミナル起動候補に追加する", async () => {
    await click('#folder-sidebar [aria-label="Show in terminal list"]');
    await browser.$('#folder-sidebar [aria-label="Remove from terminal list"]').waitForDisplayed();
    await browser.$(folderOffer).waitForDisplayed();
    assert.equal(await browser.$(folderOffer).getText(), basename(repository));
    await browser.$("#cli-sidebar .session-empty-header .page__header").waitForDisplayed();
    assert.equal((await browser.$$("#cli-sidebar .xterm")).length, 0);
    assert.equal((await browser.$$("#cli-sidebar .session-offers")).length, 0);
    assert.equal(git("log", "-1", "--format=%s"), "Initial E2E commit");

    await browser.performActions([
      {
        type: "key",
        id: "terminal-keyboard",
        actions: [
          { type: "keyDown", value: "\uE009" },
          { type: "keyDown", value: "\uE008" },
          { type: "keyDown", value: "\uE015" },
          { type: "keyUp", value: "\uE015" },
          { type: "keyUp", value: "\uE008" },
          { type: "keyUp", value: "\uE009" },
        ],
      },
    ]);
    await browser
      .$('#cli-sidebar .session-offer[data-offered="true"]')
      .waitForExist({ reverse: true });
    assert.equal(await browser.$(folderOffer).isDisplayed(), true);
    assert.equal(await browser.$(folderOffer).getText(), basename(repository));
  });

  await step("Ctrl+Shiftでフォルダーを選び、ターミナルを開く", async () => {
    await browser.performActions([
      {
        type: "key",
        id: "terminal-keyboard",
        actions: [
          { type: "keyDown", value: "\uE009" },
          { type: "keyDown", value: "\uE008" },
          { type: "keyDown", value: "\uE015" },
          { type: "keyUp", value: "\uE015" },
          { type: "keyDown", value: "\uE007" },
          { type: "keyUp", value: "\uE007" },
          { type: "keyUp", value: "\uE008" },
          { type: "keyUp", value: "\uE009" },
        ],
      },
    ]);
    await browser.$(`${terminal} .xterm-helper-textarea`).waitForExist({ timeout: 20000 });
    await browser.$(".session-canvas:not([hidden])").waitForDisplayed();
    assert.equal((await browser.$$("main .xterm")).length, 0);
    assert.equal((await browser.$$("#cli-sidebar .xterm")).length, 1);
    assert.equal((await browser.$$(folderOffer)).length, 0);
    const headerGroup = await browser.$(
      `#cli-sidebar .session-terminal:not([hidden]) .page__header .page__terminal-group[title="${repository}"]`,
    );
    assert.equal(await headerGroup.$(".page__terminal-name").getText(), basename(repository));
    assert.equal(
      await headerGroup.$('.page__terminal-numbers [data-active="true"]').getText(),
      "1",
    );
    await click(`${terminal} .xterm-screen`);
  });

  await step("PTYでファイルを作成し、Gitコミットとブランチを作る", async () => {
    // A bare Ctrl press must not latch navigation mode or block the following command.
    await browser.performActions([
      {
        type: "key",
        id: "terminal-keyboard",
        actions: [
          { type: "keyDown", value: "\uE009" },
          { type: "pause", duration: 150 },
          { type: "keyUp", value: "\uE009" },
        ],
      },
    ]);
    const command =
      "printf 'Created through the real terminal\\n' > terminal-proof.txt && git add terminal-proof.txt && git commit -m 'Terminal E2E commit' && git checkout -b e2e-proof && printf '\\nE2E_SUCCESS\\n'";
    await typeCommand(command);
    await waitFor(
      () => git("log", "-1", "--format=%s") === "Terminal E2E commit",
      "terminal command committed the file",
    );
    await waitFor(
      () => git("branch", "--list", "--format=%(refname:short)", "e2e-proof") === "e2e-proof",
      "branch was created",
    );
    assert.equal(
      readFileSync(join(repository, "terminal-proof.txt"), "utf8"),
      "Created through the real terminal\n",
    );
    assert.equal(git("show", "HEAD:terminal-proof.txt"), "Created through the real terminal");
    assert.equal(git("status", "--porcelain"), "");
  });

  await step("Rustの変更監視を通じ、現在のブランチがフォルダー一覧に反映される", async () => {
    await browser.waitUntil(
      async () => (await browser.$(repositoryRow).getText()).includes("e2e-proof"),
      { timeout: 30000 },
    );
  });

  await step("OSC 52でコピーした日本語をCtrl+Vで貼り付ける", async () => {
    const expected = `OSC52_日本語_${Date.now()}`;
    const encoded = Buffer.from(expected, "utf8").toString("base64");
    await typeCommand(`printf '\\033]52;c;${encoded}\\007'`);
    await verifyPaste("osc52-clipboard-proof", expected);
  });

  await step("ターミナルの文字選択をCtrl+Cでコピーし、Ctrl+Vで貼り付ける", async () => {
    const expected = "SELECTIONCOPYE2EPROOF";
    const ready = join(repository, ".git/selection-ready");
    await typeCommand(`printf '\\033[2J\\033[H${expected}\\033[2;1H'; touch .git/selection-ready`);
    await waitFor(() => existsSync(ready), "selection text was printed");
    const screen = await browser.$(`${terminal} .xterm-screen`);
    const position = await screen.getLocation();
    // Double-click the known first word through actual pointer input.
    await browser.performActions([
      {
        type: "pointer",
        id: "terminal-mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          {
            type: "pointerMove",
            duration: 0,
            origin: "viewport",
            x: Math.round(position.x) + 8,
            y: Math.round(position.y) + 6,
          },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
          { type: "pause", duration: 80 },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
    await controlKey("c");
    await verifyPaste("selection-clipboard-proof", expected);
  });

  await step("ファイル一覧に戻り、作成したファイルをプレビューする", async () => {
    // The terminal stays open: the file belongs to its canvas.
    await click(`${repositoryRow} button[aria-expanded="false"]`);
    const file = await browser.$(
      `#folder-sidebar [data-pick-row="${repository}/terminal-proof.txt"]`,
    );
    await file.waitForDisplayed();
    await file.doubleClick();
    await browser.waitUntil(
      async () =>
        (await browser.$(".session-canvas:not([hidden])").getText()).includes(
          "Created through the real terminal",
        ),
      { timeout: 20000, timeoutMsg: "file preview did not display the saved content" },
    );
    assert.ok(existsSync(join(repository, "terminal-proof.txt")));
  });

  await step("Ctrl+Space中だけ表示枠を削除し、ファイルとターミナルを保つ", async () => {
    await click(`${terminal} .xterm-screen`);
    await browser.performActions([
      {
        type: "key",
        id: "terminal-keyboard",
        actions: [
          { type: "keyDown", value: "\uE009" },
          { type: "keyDown", value: " " },
          { type: "keyDown", value: "x" },
          { type: "keyUp", value: "x" },
          { type: "keyUp", value: " " },
          { type: "keyUp", value: "\uE009" },
        ],
      },
    ]);
    await browser
      .$(".session-canvas:not([hidden]) [data-canvas-pane]")
      .waitForExist({ reverse: true });
    assert.equal((await browser.$$("#cli-sidebar .xterm")).length, 1);
    assert.equal(
      readFileSync(join(repository, "terminal-proof.txt"), "utf8"),
      "Created through the real terminal\n",
    );
    await browser.waitUntil(async () =>
      browser.execute(() =>
        Boolean(
          document.activeElement?.matches('[data-terminal-shown="true"] .xterm-helper-textarea'),
        ),
      ),
    );
  });

  await step("最後のターミナルを閉じてもリポジトリ名が右上に残る", async () => {
    await controlKey("x");
    await browser.$("#cli-sidebar .xterm").waitForExist({ reverse: true });
    await browser.$(folderOffer).waitForDisplayed();
    assert.equal(await browser.$(folderOffer).getText(), basename(repository));
    await browser.$("#cli-sidebar .session-empty-header .page__header").waitForDisplayed();
    assert.ok(existsSync(join(repository, "terminal-proof.txt")));
  });
}
