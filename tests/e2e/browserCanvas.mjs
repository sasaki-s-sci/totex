import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as probePort } from "node:net";
import { join } from "node:path";
import { waitFor } from "./runtime.mjs";

/** Real window, its own private runtime/MCP session, and the bundled browser entry. */
export async function browserCanvas(
  native,
  repository,
  step,
  { chromium, executablePath, env, output },
) {
  let browser;
  let context;
  let page;
  let id;
  let mcpUrl;
  let endpoint;
  let transportOverridden = false;
  let serving = false;
  const live = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Canvas application</title>
      <style>body{font:16px sans-serif;padding:24px}label,input,button,output{display:block;margin:16px 0}input{border:0;border-bottom:1px solid #789;padding:8px}output{color:#166534}</style>
      <h1>Live application</h1><label>Name <input></label><button>Apply</button><output>Ready</output>
      <script>window.instance=crypto.randomUUID();document.querySelector('button').onclick=()=>{
      document.querySelector('output').textContent=document.querySelector('input').value;};</script></html>`);
  });
  const invoke = (command, args = {}) =>
    native
      .executeAsync(
        (command, args, done) => {
          window.__TOTEX_NATIVE__.invoke(command, args).then(
            (value) => done({ value }),
            (error) => done({ error: String(error) }),
          );
        },
        command,
        args,
      )
      .then((result) => {
        if (result.error) throw new Error(result.error);
        return result.value;
      });
  const mcp = async (args = {}) => {
    const response = await fetch(mcpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "canvas", arguments: args },
      }),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200, "The private terminal MCP endpoint responds");
    const answer = await response.json();
    assert.equal(answer.error, undefined);
    assert.notEqual(answer.result.isError, true, answer.result.content?.[0]?.text);
    return answer.result.structuredContent;
  };
  try {
    // Production MCP has a registered fixed port. Never reuse a developer's listener.
    const unused = probePort();
    await new Promise((resolve, reject) => {
      unused.once("error", () =>
        reject(
          new Error(
            "Native browser E2E needs the unused private MCP port26374; an existing listener was left untouched.",
          ),
        ),
      );
      unused.listen(26374, "127.0.0.1", resolve);
    });
    await new Promise((resolve) => unused.close(resolve));
    await new Promise((resolve) => live.listen(0, "127.0.0.1", resolve));
    const liveUrl = `http://127.0.0.1:${live.address().port}/`;

    await step("MCPから実ターミナルのキャンバスにWebページとファイルを表示する", async () => {
      await invoke("mcp_serve");
      serving = true;
      await native.$('[aria-label="New canvas"]').click();
      await native.$('[role="menuitem"]').click();
      await native.$('[data-terminal-shown="true"]').waitForExist();
      id = await native.$('[data-terminal-shown="true"]').getAttribute("data-terminal");
      const credentialFile = join(repository, ".git/browser-canvas-mcp-url");
      // The file is inside the runner's temporary repository and is removed with it.
      await invoke("pty_write", {
        id,
        data: "printf '%s\\n' \"$TOTEX_MCP_URL\" > .git/browser-canvas-mcp-url\n",
      });
      await waitFor(
        () =>
          existsSync(credentialFile) &&
          readFileSync(credentialFile, "utf8").trim().startsWith("http://127.0.0.1:26374/s/"),
        "private terminal MCP address",
      );
      mcpUrl = readFileSync(credentialFile, "utf8").trim();
      const before = await mcp();
      await mcp({
        revision: before.revision,
        panes: [
          { id: "live", kind: "iframe", url: liveUrl, title: "Live application" },
          {
            id: "source",
            kind: "file",
            path: join(repository, "terminal-proof.txt"),
            view: "text",
          },
        ],
      });
      await native.$('[data-canvas-pane="source"]').waitForDisplayed();
    });

    await step("キャンバスを外部ブラウザーのタブで開く", async () => {
      // Capture only the OS opener call; canvas_browser_open and its HTTP server remain real.
      await native.execute(() => {
        const transport = window.__TOTEX_NATIVE__;
        const original = transport.invoke;
        window.__restoreCanvasOpener = () => {
          transport.invoke = original;
        };
        transport.invoke = (command, args) => {
          if (command === "plugin:opener|open_url") {
            window.__openedCanvasUrl = args.url;
            return Promise.resolve();
          }
          return original(command, args);
        };
      });
      transportOverridden = true;
      await native.$('[data-canvas-pane="source"]').click({ button: "right" });
      await native.$('//li[@role="menuitem" and contains(.,"Open canvas in browser")]').click();
      await native.waitUntil(() => native.execute(() => Boolean(window.__openedCanvasUrl)));
      endpoint = await native.execute(() => window.__openedCanvasUrl);
      assert.match(endpoint, /^http:\/\/127\.0\.0\.1:\d+\/browser\.html#[0-9a-f-]+$/);
      browser = await chromium.launch({
        executablePath,
        headless: false,
        env,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--window-size=900,640",
          "--window-position=0,0",
        ],
      });
      context = await browser.newContext({
        viewport: { width: 900, height: 640 },
        recordVideo: { dir: output, size: { width: 900, height: 640 } },
      });
      context.setDefaultTimeout(15000);
      page = await context.newPage();
      await page.goto(endpoint);
      await page
        .locator(`[data-session-canvas="${id}"]`)
        .getByRole("textbox", { name: "terminal-proof.txt", exact: true })
        .waitFor();
      assert.equal(await page.locator("[data-terminal]").count(), 0);
      await page.screenshot({ path: join(output, "browser-canvas-open.png") });
    });

    await step("外部ブラウザー内のWebページを操作し、ターミナル切替後も表示を保つ", async () => {
      await page.waitForFunction(() => document.querySelectorAll("iframe").length > 0);
      let frame;
      await waitFor(() => {
        frame = page.frames().find((candidate) => candidate.url() === liveUrl);
        return Boolean(frame);
      }, "live application frame");
      await frame.getByLabel("Name").fill("Controlled through browser automation");
      await frame.getByRole("button", { name: "Apply" }).click();
      assert.equal(
        await frame.locator("output").textContent(),
        "Controlled through browser automation",
      );
      const instance = await frame.evaluate(() => window.instance);
      await native.$('[data-terminal-shown="true"] .xterm-helper-textarea').click();
      await native.performActions([
        {
          type: "key",
          id: "browser-canvas-keys",
          actions: [
            { type: "keyDown", value: "\uE009" },
            { type: "keyDown", value: "a" },
            { type: "keyUp", value: "a" },
            { type: "keyUp", value: "\uE009" },
          ],
        },
      ]);
      await native.waitUntil(
        async () =>
          (await native.$('[data-terminal-shown="true"]').getAttribute("data-terminal")) !== id,
      );
      const before = await mcp();
      await mcp({
        revision: before.revision,
        panes: [
          ...before.panes,
          {
            id: "mcp-update",
            kind: "markdown",
            text: "# MCP changed the pinned canvas\n\nThe selected terminal is independent.",
          },
        ],
      });
      await page.getByRole("heading", { name: "MCP changed the pinned canvas" }).waitFor();
      assert.equal(await frame.evaluate(() => window.instance), instance);
      assert.equal(
        await frame.getByLabel("Name").inputValue(),
        "Controlled through browser automation",
      );
      assert.equal(
        await page.locator("[data-session-canvas]").getAttribute("data-session-canvas"),
        id,
      );
      await page.screenshot({ path: join(output, "browser-canvas-pinned.png") });
    });

    await step("外部ブラウザーからファイルを保存し、MCPで現在の内容を確認する", async () => {
      await page.bringToFront();
      const reading = page.getByRole("textbox", { name: "terminal-proof.txt", exact: true });
      await reading.fill("Saved from the external browser canvas");
      await page.keyboard.press("Control+s");
      await waitFor(
        () =>
          readFileSync(join(repository, "terminal-proof.txt"), "utf8") ===
          "Saved from the external browser canvas",
        "external canvas file save",
      );
      assert.equal(
        (await mcp()).panes.some((pane) => pane.id === "source"),
        true,
      );
      const url = new URL(endpoint);
      const request = async (command, args) =>
        fetch(`${url.origin}/api`, {
          method: "POST",
          headers: {
            Origin: url.origin,
            Authorization: `Bearer ${url.hash.slice(1)}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ command, args }),
          signal: AbortSignal.timeout(10000),
        });
      assert.equal(
        (await request("read_file_head", { path: join(repository, ".git/config") })).status,
        400,
      );
      assert.equal((await request("pty_sessions", {})).status, 400);
      await page.screenshot({ path: join(output, "browser-canvas-saved.png") });
    });
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: join(output, "browser-canvas-failed.png") }).catch(() => {});
      const state = await page
        .evaluate(() => ({
          editors: [...document.querySelectorAll('[role="textbox"][contenteditable]')].map(
            (element) => ({ text: element.textContent, html: element.innerHTML }),
          ),
          alerts: [...document.querySelectorAll('[role="alert"],.canvas-file-status')].map(
            (element) => element.textContent,
          ),
        }))
        .catch(() => null);
      writeFileSync(
        join(output, "browser-canvas-diagnostic.json"),
        JSON.stringify(
          {
            disk: readFileSync(join(repository, "terminal-proof.txt"), "utf8"),
            state,
          },
          null,
          2,
        ),
      );
    }
    throw error;
  } finally {
    if (transportOverridden)
      await native.execute(() => window.__restoreCanvasOpener?.()).catch(() => {});
    if (serving) await invoke("mcp_stop").catch(() => {});
    const video = page?.video();
    await context?.close();
    if (video) await video.saveAs(join(output, "browser-canvas.webm"));
    await browser?.close();
    await new Promise((resolve) => live.close(resolve));
  }
}
