import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSshTyped, readSshHost, sshFailure, sshHostOf } from "../src/lib/ssh.ts";

test("an ssh command lands at home on its host", () => {
  assert.deepEqual(parseSshTyped("ssh a@192.168.1.10"), {
    host: "a@192.168.1.10",
    path: "~",
    url: "ssh://a@192.168.1.10/~",
  });
  assert.deepEqual(parseSshTyped("  ssh   box  "), { host: "box", path: "~", url: "ssh://box/~" });
});

test("a word after the destination is where it lands", () => {
  assert.equal(parseSshTyped("ssh a@ip /srv/repo")?.url, "ssh://a@ip/srv/repo");
  assert.equal(parseSshTyped("ssh a@ip /srv/repo/")?.url, "ssh://a@ip/srv/repo");
  assert.equal(parseSshTyped("ssh a@ip ~/repo")?.url, "ssh://a@ip/~/repo");
  assert.equal(parseSshTyped("ssh a@ip ~/")?.url, "ssh://a@ip/~");
  assert.equal(parseSshTyped("ssh a@ip repo")?.url, "ssh://a@ip/~/repo");
  assert.equal(parseSshTyped("ssh a@ip /")?.url, "ssh://a@ip/");
});

test("a port goes into the host, wherever it is given", () => {
  assert.equal(parseSshTyped("ssh -p 2222 a@ip")?.host, "a@ip:2222");
  assert.equal(parseSshTyped("ssh a@ip -p 2222")?.host, "a@ip:2222");
  assert.equal(parseSshTyped("ssh -p2222 a@ip ~/repo")?.url, "ssh://a@ip:2222/~/repo");
  assert.equal(parseSshTyped("ssh -l a ip")?.host, "a@ip");
  assert.equal(parseSshTyped("ssh -i ~/.ssh/key -v a@ip")?.host, "a@ip");
});

test("anything but an ssh command is a path", () => {
  assert.equal(parseSshTyped("a@ip"), null);
  assert.equal(parseSshTyped("~/repo"), null);
  assert.equal(parseSshTyped("ssh://a@ip/~"), null);
  assert.equal(parseSshTyped("sshd a@ip"), null);
  assert.equal(parseSshTyped("ssh"), null);
  assert.equal(parseSshTyped("ssh -p"), null);
  assert.equal(parseSshTyped("ssh -p x a@ip"), null);
  assert.equal(parseSshTyped("ssh a@ip ls -la /"), null);
});

test("a host to register is a bare host or a command", () => {
  assert.equal(readSshHost("a@ip"), "a@ip");
  assert.equal(readSshHost(" a@ip:2222 "), "a@ip:2222");
  assert.equal(readSshHost("ssh -p 2222 a@ip"), "a@ip:2222");
  assert.equal(readSshHost("ssh://box/~"), "box");
  assert.equal(readSshHost(""), null);
  assert.equal(readSshHost("a b"), null);
  assert.equal(readSshHost("/home/a"), null);
});

test("the host of a remote path", () => {
  assert.equal(sshHostOf("ssh://a@ip:2222/~/repo"), "a@ip:2222");
  assert.equal(sshHostOf("ssh://box"), "box");
  assert.equal(sshHostOf("/home/a"), null);
});

test("backend failures are read into message keys", () => {
  assert.deepEqual(sshFailure("ssh-host-key"), { key: "ssh.hostKey", reason: "" });
  assert.deepEqual(sshFailure("ssh-unreachable: timed out"), {
    key: "ssh.unreachable",
    reason: "timed out",
  });
  assert.deepEqual(sshFailure("boom"), { key: "ssh.failed", reason: "boom" });
});
