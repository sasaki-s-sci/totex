import assert from "node:assert/strict";
import { test } from "node:test";
import { layerOf, lineOf, reading, wanted } from "../src/lib/update/reading.ts";

const choice = (version, ephemeralContract, persistentAvailable = true) => ({
  version,
  ephemeralContract,
  persistentAvailable,
  frontContract: 12,
});
// Running 1.0.0 on host-a; two patches on the line, one minor beyond it, one
// line behind, and a legacy release with no host at all.
function state() {
  return {
    rungs: [
      { layer: "persistent", at: "1.0.0", ephemeralContract: "host-a", can: true, picked: null },
      { layer: "ephemeral", at: "1.0.0", ephemeralContract: "host-a", can: true, picked: null },
    ],
    choices: [
      choice("2.0.0", "host-b"),
      choice("1.0.2", "host-a"),
      choice("1.0.1", "host-a"),
      choice("1.0.0", "host-a"),
      choice("0.9.0", "host-0"),
      choice("0.8.0", null),
    ],
    presses: {},
  };
}
const pin = (at, version) => {
  for (const rung of at.rungs) rung.picked = version;
};

test("latest offers the newest patch on the line and the newest minor beyond it", () => {
  const read = reading(state());
  assert.equal(read.patch.version, "1.0.2");
  assert.equal(read.minor.version, "2.0.0");
  assert.equal(read.latest, "2.0.0");
  assert.equal(read.picked, "latest");
});

test("a release is a patch or a minor by whether it shares the running contract", () => {
  const at = state();
  assert.equal(layerOf(at, choice("1.0.2", "host-a")), "ephemeral");
  assert.equal(layerOf(at, choice("2.0.0", "host-b")), "persistent");
  assert.equal(layerOf(at, choice("0.8.0", null)), null);
  assert.deepEqual(
    reading(at).choices.map((c) => c.version),
    ["2.0.0", "1.0.2", "1.0.1", "1.0.0", "0.9.0"],
  );
  assert.deepEqual(
    reading(at).blocked.map((c) => c.version),
    ["0.8.0"],
  );
});

test("a version named in the pull-down is taken by the one button that can bring it", () => {
  const at = state();
  pin(at, "1.0.1");
  let read = reading(at);
  assert.equal(read.patch.version, "1.0.1");
  assert.equal(read.minor, null);
  assert.equal(wanted(at, "ephemeral"), "1.0.1");

  pin(at, "2.0.0");
  read = reading(at);
  assert.equal(read.patch, null);
  assert.equal(read.minor.version, "2.0.0");
  assert.equal(wanted(at, "persistent"), "2.0.0");

  // A line behind the running one is a downgrade, offered only by name.
  pin(at, "0.9.0");
  assert.equal(reading(at).minor.version, "0.9.0");
});

test("a pinned version the release page no longer offers is kept, pointed at nothing", () => {
  const at = state();
  pin(at, "1.0.7");
  const read = reading(at);
  assert.equal(read.picked, "1.0.7");
  assert.equal(read.patch, null);
  assert.equal(read.minor, null);
  // A press with nothing to move to keeps up with what is in place.
  assert.equal(wanted(at, "ephemeral"), "1.0.0");
});

test("up to date on the line, with only the minor left to take", () => {
  const at = state();
  at.rungs[1].at = "1.0.2";
  const read = reading(at);
  assert.equal(read.at, "1.0.2");
  assert.equal(read.app, "1.0.0");
  assert.equal(read.patch.version, "1.0.2");
  assert.equal(read.minor.version, "2.0.0");
});

test("a newer patch on the line is not a minor", () => {
  const at = state();
  at.choices = at.choices.filter((c) => c.ephemeralContract === "host-a");
  const read = reading(at);
  assert.equal(read.minor, null);
  assert.equal(read.patch.version, "1.0.2");
  assert.equal(read.latest, "1.0.2");
});

test("a package-managed copy takes patches and shows minors as unavailable", () => {
  const at = state();
  at.rungs[0].can = false;
  const read = reading(at);
  assert.equal(read.can, true);
  assert.equal(read.patch.version, "1.0.2");
  assert.equal(read.minor, null);
  assert.deepEqual(
    read.blocked.map((c) => c.version),
    ["2.0.0", "0.9.0", "0.8.0"],
  );
});

test("after the restart into a minor the row is up to date on the new line", () => {
  const at = state();
  pin(at, "2.0.0");
  at.rungs[0].ephemeralContract = at.rungs[1].ephemeralContract = "host-b";
  at.rungs[0].at = at.rungs[1].at = "2.0.0";
  const read = reading(at);
  assert.equal(read.patch.version, "2.0.0");
  assert.equal(read.minor, null);
  assert.equal(wanted(at, "ephemeral"), "2.0.0");
});

// A window drawing 1.2.3 out of a 1.2.3 program whose shell contract is `same`:
// a patch that carries another contract is still a patch, installed and the
// window reopened over the running service, and only another line is a minor.
function standing(picked = null) {
  const rung = (layer) => ({ layer, at: "1.2.3", ephemeralContract: "same", can: true, picked });
  return { rungs: [rung("persistent"), rung("ephemeral")], choices: [], presses: {} };
}

test("a patch that shares the contract is drawn in place", () => {
  const at = { ...standing(), choices: [choice("1.2.4", "same")] };
  const read = reading(at);
  assert.equal(read.patch.version, "1.2.4");
  assert.equal(read.reopens, false);
  assert.equal(layerOf(at, read.patch), "ephemeral");
  assert.equal(read.minor, null);
  assert.equal(wanted(at, "ephemeral"), "1.2.4");
  assert.equal(wanted(at, "persistent"), "1.2.3");
});

test("a patch that carries another contract installs the program and reopens the window", () => {
  const at = { ...standing(), choices: [choice("1.2.5", "other"), choice("1.2.4", "same")] };
  const read = reading(at);
  assert.equal(read.patch.version, "1.2.5");
  assert.equal(read.reopens, true);
  assert.equal(layerOf(at, read.patch), "persistent");
  assert.equal(read.minor, null);
  assert.equal(wanted(at, "persistent"), "1.2.5");
  assert.equal(wanted(at, "ephemeral"), "1.2.3");
});

test("another line is the minor button, never the patch button", () => {
  const at = { ...standing(), choices: [choice("1.3.0", "other"), choice("1.2.4", "other")] };
  const read = reading(at);
  assert.equal(read.patch.version, "1.2.4");
  assert.equal(read.reopens, true);
  assert.equal(read.minor.version, "1.3.0");
  assert.equal(read.latest, "1.3.0");
});

test("a pinned program on the running line is a patch that reopens", () => {
  const choices = [choice("1.3.0", "other"), choice("1.2.5", "other"), choice("1.2.2", "same")];
  let read = reading({ ...standing("1.2.2"), choices });
  assert.equal(read.patch.version, "1.2.2");
  assert.equal(read.reopens, false);
  assert.equal(read.minor, null);
  read = reading({ ...standing("1.2.5"), choices });
  assert.equal(read.patch.version, "1.2.5");
  assert.equal(read.reopens, true);
  read = reading({ ...standing("1.3.0"), choices });
  assert.equal(read.patch, null);
  assert.equal(read.minor.version, "1.3.0");
});

test("a program behind the running one on its own line is not offered unnamed", () => {
  const read = reading({ ...standing(), choices: [choice("1.2.2", "other")] });
  assert.equal(read.patch, null);
  assert.equal(read.minor, null);
});

test("the line is the first two numbers", () => {
  assert.equal(lineOf("1.2.3"), "1.2");
  assert.equal(lineOf("10.0.7"), "10.0");
});

test("latest skips intermediate versions regardless of listing order", () => {
  const at = standing();
  at.choices = [
    choice("1.2.4", "same"),
    choice("1.3.0", "other"),
    choice("1.2.9", "same"),
    choice("1.10.4", "newest"),
    choice("1.2.12", "other"),
    choice("1.4.0", "other"),
  ];
  const read = reading(at);
  assert.equal(read.patch.version, "1.2.12");
  assert.equal(read.minor.version, "1.10.4");
  assert.equal(read.latest, "1.10.4");
  assert.equal(read.reopens, true);
  assert.deepEqual(
    read.choices.map((choice) => choice.version),
    ["1.10.4", "1.4.0", "1.3.0", "1.2.12", "1.2.9", "1.2.4"],
  );
});

test("latest skips unavailable releases and never downgrades the running views", () => {
  const at = standing();
  at.rungs[1].at = "1.2.8";
  at.choices = [
    choice("1.2.7", "same"),
    choice("1.3.0", "other"),
    choice("1.9.0", "missing", false),
  ];
  const read = reading(at);
  assert.equal(read.patch, null);
  assert.equal(read.minor.version, "1.3.0");
});
