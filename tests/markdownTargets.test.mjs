import assert from "node:assert/strict";
import { test } from "node:test";
import { linkTarget, pictureTarget, slugOf } from "../src/canvas/nodes/preview/markdownTargets.ts";

const file = (path) => ({ kind: "file", path });
const web = (url) => ({ kind: "web", url });

test("a relative picture is found beside the markdown file, on every kind of path", () => {
  assert.deepEqual(
    pictureTarget("images/a.png", "/home/a/doc/README.md"),
    file("/home/a/doc/images/a.png"),
  );
  assert.deepEqual(pictureTarget("./a.png", "/home/a/doc/README.md"), file("/home/a/doc/a.png"));
  assert.deepEqual(
    pictureTarget("../img/a.png", "/home/a/doc/README.md"),
    file("/home/a/img/a.png"),
  );
  assert.deepEqual(
    pictureTarget("img/a.png", "C:\\Users\\u\\doc\\README.md"),
    file("C:\\Users\\u\\doc\\img\\a.png"),
  );
  assert.deepEqual(
    pictureTarget("../a.png", "\\\\wsl.localhost\\Ubuntu\\home\\a\\README.md"),
    file("\\\\wsl.localhost\\Ubuntu\\home\\a.png"),
  );
  assert.deepEqual(
    pictureTarget("img/a.png", "ssh://box/home/a/README.md"),
    file("ssh://box/home/a/img/a.png"),
  );
  assert.deepEqual(pictureTarget("a.png", "ssh://box/README.md"), file("ssh://box/a.png"));
});

test("an absolute picture stays on the markdown file's own machine, and never climbs past its root", () => {
  assert.deepEqual(pictureTarget("/srv/a.png", "/home/a/README.md"), file("/srv/a.png"));
  assert.deepEqual(
    pictureTarget("/srv/a.png", "ssh://box/home/a/README.md"),
    file("ssh://box/srv/a.png"),
  );
  assert.deepEqual(pictureTarget("/srv/a.png", "C:\\doc\\README.md"), file("C:\\srv\\a.png"));
  assert.deepEqual(pictureTarget("D:/pics/a.png", "C:\\doc\\README.md"), file("D:\\pics\\a.png"));
  assert.deepEqual(pictureTarget("../../../a.png", "/home/README.md"), file("/a.png"));
  assert.deepEqual(
    pictureTarget("file:///C:/pics/a.png", "C:\\doc\\README.md"),
    file("C:\\pics\\a.png"),
  );
});

test("escapes, queries and fragments in a picture's path are read the way a browser reads them", () => {
  assert.deepEqual(pictureTarget("my%20pic.png?raw=1#x", "/d/README.md"), file("/d/my pic.png"));
});

test("pictures on the web and in data are drawn as they are; other schemes are not", () => {
  assert.deepEqual(
    pictureTarget("https://example.com/a.png", "/d/README.md"),
    web("https://example.com/a.png"),
  );
  assert.deepEqual(
    pictureTarget("//example.com/a.png", "/d/README.md"),
    web("https://example.com/a.png"),
  );
  assert.deepEqual(
    pictureTarget("data:image/png;base64,AA==", "/d/README.md"),
    web("data:image/png;base64,AA=="),
  );
  assert.equal(pictureTarget("javascript:alert(1)", "/d/README.md"), null);
  assert.equal(pictureTarget("data:text/html,x", "/d/README.md"), null);
  assert.equal(pictureTarget("", "/d/README.md"), null);
});

test("links go to an anchor, the web, mail, or another file", () => {
  assert.deepEqual(linkTarget("#Install%20it", "/d/README.md"), {
    kind: "anchor",
    name: "Install it",
  });
  assert.deepEqual(linkTarget("https://example.com", "/d/README.md"), web("https://example.com/"));
  assert.deepEqual(linkTarget("mailto:a@b.c", "/d/README.md"), web("mailto:a@b.c"));
  assert.deepEqual(linkTarget("docs/guide.md#setup", "/d/README.md"), file("/d/docs/guide.md"));
  assert.equal(linkTarget("javascript:alert(1)", "/d/README.md"), null);
  assert.equal(linkTarget("vscode://x", "/d/README.md"), null);
});

test("headings are given GitHub's anchors", () => {
  assert.equal(slugOf("Getting Started!"), "getting-started");
  assert.equal(slugOf("API v2.0 — notes"), "api-v20--notes");
  assert.equal(slugOf("日本語の見出し"), "日本語の見出し");
  assert.equal(slugOf("snake_case"), "snake_case");
});
