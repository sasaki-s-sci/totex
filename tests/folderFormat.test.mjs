import assert from "node:assert/strict";
import { test } from "node:test";
import { baseName, displayPath, folderLabels, folderOf, isInside } from "../src/folder/format.ts";

test("a root keeps its spelling and anything else is its last step", () => {
  assert.equal(baseName("/"), "/");
  assert.equal(baseName("/home"), "home");
  assert.equal(baseName("/home/a"), "a");
  assert.equal(baseName("/home/a/"), "a");
  assert.equal(baseName("C:\\Users"), "Users");
  assert.equal(baseName("C:\\"), "C:\\");
  assert.equal(baseName("C:/"), "C:/");
  assert.equal(baseName("C:\\Users\\a"), "a");
  assert.equal(baseName("\\\\wsl.localhost\\Ubuntu\\home\\a"), "a");
  assert.equal(baseName("ssh://box/"), "ssh://box/");
  assert.equal(baseName("ssh://box"), "ssh://box");
  assert.equal(baseName("ssh://box/home"), "home");
  assert.equal(baseName("ssh://box/home/a"), "a");
  assert.equal(baseName("ssh://box/home/a/"), "a");
});

test("the folder of a path is spelled the way the path was", () => {
  assert.equal(folderOf("/"), null);
  assert.equal(folderOf("/home"), "/");
  assert.equal(folderOf("/home/a"), "/home");
  assert.equal(folderOf("/home/a/"), "/home");
  assert.equal(folderOf("C:\\"), null);
  assert.equal(folderOf("C:\\note.txt"), "C:\\");
  assert.equal(folderOf("C:/note.txt"), "C:/");
  assert.equal(folderOf("C:\\Users\\a"), "C:\\Users");
  assert.equal(folderOf("\\\\wsl.localhost\\Ubuntu\\home\\a"), "\\\\wsl.localhost\\Ubuntu\\home");
  assert.equal(folderOf("ssh://box/"), null);
  assert.equal(folderOf("ssh://box"), null);
  assert.equal(folderOf("ssh://box/home"), "ssh://box/");
  assert.equal(folderOf("ssh://box/home/"), "ssh://box/");
  assert.equal(folderOf("ssh://box/home/a"), "ssh://box/home");
});

test("a path is inside a folder only at a separator", () => {
  assert.equal(isInside("/", "/home"), true);
  assert.equal(isInside("/home", "/home"), true);
  assert.equal(isInside("/home", "/homely"), false);
  assert.equal(isInside("C:\\", "C:\\Users"), true);
  assert.equal(isInside("C:\\Users", "C:\\Users\\a"), true);
  assert.equal(isInside("C:\\Users", "C:\\User"), false);
  assert.equal(isInside("ssh://box/", "ssh://box/home"), true);
  assert.equal(isInside("ssh://box/home", "ssh://box/home/a"), true);
  assert.equal(isInside("ssh://box/home", "ssh://box/homely"), false);
  assert.equal(isInside("ssh://box/", "ssh://other/home"), false);
});

test("display turns backslashes forward and leaves ssh spellings alone", () => {
  assert.equal(displayPath("C:\\Users\\a"), "C:/Users/a");
  assert.equal(displayPath("\\\\wsl.localhost\\Ubuntu\\home"), "//wsl.localhost/Ubuntu/home");
  assert.equal(displayPath("ssh://box/home/a"), "ssh://box/home/a");
});

test("folder labels stay short for unique names and repeated canvases of the same folder", () => {
  assert.deepEqual(folderLabels(["/work/app", "/home/docs", "/work/app/"]), ["app", "docs", "app"]);
  assert.deepEqual(folderLabels(["C:\\work\\app", "C:/work/app/"]), ["app", "app"]);
});

test("folder labels include only the ancestors needed to distinguish matching names", () => {
  assert.deepEqual(
    folderLabels(["/work/team/app", "/home/team/app", "/work/tools/app", "/work/team/app"]),
    ["work/team/app", "home/team/app", "tools/app", "work/team/app"],
  );
  assert.deepEqual(folderLabels(["/app", "/work/app"]), ["/app", "work/app"]);
  assert.deepEqual(folderLabels(["/work/app"]), ["app"]);
});

test("folder labels distinguish drives and hosts and preserve root names", () => {
  assert.deepEqual(folderLabels(["C:\\work\\app", "D:/work/app"]), ["C:/work/app", "D:/work/app"]);
  assert.deepEqual(folderLabels(["ssh://one/home/app", "ssh://two/home/app"]), [
    "one/home/app",
    "two/home/app",
  ]);
  assert.deepEqual(folderLabels(["\\\\one\\share\\app", "\\\\two\\share\\app"]), [
    "one/share/app",
    "two/share/app",
  ]);
  assert.deepEqual(folderLabels(["/", "C:\\", "ssh://one/"]), ["/", "C:/", "ssh://one/"]);
});
