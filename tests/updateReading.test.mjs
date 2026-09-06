import assert from "node:assert/strict";
import { test } from "node:test";
import { compatibleChoices, standing } from "../src/components/settings/updateReading.ts";

const choice = (version, ephemeralContract, persistentAvailable = true) => ({
  version,
  ephemeralContract,
  persistentAvailable,
  frontContract: 12,
});
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
      choice("0.9.0", null),
    ],
  };
}
test("one persistent release offers multiple compatible ephemeral versions including rollback", () => {
  const at = state();
  assert.deepEqual(
    compatibleChoices(at, "host-a").map((c) => c.version),
    ["1.0.2", "1.0.1", "1.0.0"],
  );
  assert.equal(standing(at, "ephemeral").target.version, "1.0.2");
  at.rungs[1].at = "1.0.2";
  at.rungs[1].picked = "1.0.0";
  assert.equal(standing(at, "ephemeral").to, "1.0.0");
});
test("incompatible and legacy releases remain visible but cannot be selected or applied", () => {
  const at = state();
  const row = standing(at, "ephemeral");
  assert.deepEqual(
    row.blocked.map((c) => c.version),
    ["2.0.0", "0.9.0"],
  );
  at.rungs[1].picked = "2.0.0";
  assert.equal(standing(at, "ephemeral").target, null);
  assert.equal(standing(at, "ephemeral").picked, "2.0.0");
});
test("persistent updates select a whole bundle with its corresponding views", () => {
  const at = state();
  const runtime = standing(at, "persistent");
  assert.equal(runtime.target.version, "2.0.0");
  assert.deepEqual(
    compatibleChoices(at, runtime.target.ephemeralContract).map((c) => c.version),
    ["2.0.0"],
  );
  at.rungs[0].ephemeralContract = "host-b";
  at.rungs[0].at = at.rungs[1].at = "2.0.0";
  assert.equal(standing(at, "ephemeral").to, null);
});
test("a package-managed copy can offer views without offering runtime installation", () => {
  const at = state();
  at.rungs[0].can = false;
  assert.equal(standing(at, "persistent").can, false);
  assert.equal(standing(at, "ephemeral").can, true);
});

test("new view releases on the same host do not offer a persistent restart", () => {
  const at = state();
  at.choices = at.choices.filter((choice) => choice.ephemeralContract === "host-a");
  const runtime = standing(at, "persistent");
  assert.equal(runtime.choices.length, 1);
  assert.equal(runtime.target.version, "1.0.0");
  assert.equal(runtime.to, null);
  assert.equal(standing(at, "ephemeral").to, "1.0.2");
});
