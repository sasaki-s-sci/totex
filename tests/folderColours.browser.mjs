import assert from "node:assert/strict";

/** Both modes render the real folder rows; only the Git answers come from the IPC fixture. */
export async function verifyFolderColours(page, base = "http://127.0.0.1:18422") {
  await page.goto(`${base}/tests/fixtures/files.html?git`);
  const row = (name) => page.locator(`[data-pick-row="/files/${name}"]`);
  await row("alpha.txt").waitFor();
  const palette = await page.evaluate(() => {
    const sample = document.createElement("span");
    document.body.append(sample);
    const colours = {};
    for (const token of [
      "success-main",
      "warning-main",
      "text-disabled",
      "text-primary",
      "text-secondary",
    ]) {
      sample.style.color = `var(--mui-palette-${token})`;
      colours[token] = getComputedStyle(sample).color;
    }
    sample.remove();
    return colours;
  });
  const colour = (name, token, part = ".MuiListItemText-primary") =>
    page.waitForFunction(
      ({ name, expected, part }) => {
        const element = document.querySelector(`[data-pick-row="/files/${name}"] ${part}`);
        return element && getComputedStyle(element).color === expected;
      },
      { name, expected: palette[token], part },
    );

  await page.evaluate(() => {
    window.fsChanges = {
      "/files": {
        changed: { "alpha.txt": "added", "beta.txt": "modified", "folder.dir": "modified" },
        ignored: ["folder.dir", "gamma.txt"],
        allIgnored: false,
      },
      "/files/folder.dir": { changed: { "child.txt": "modified" }, ignored: [], allIgnored: false },
    };
    window.fsEmit("fs:changed", ["/files"]);
  });
  assert.equal(await page.getByRole("button", { name: "Switch to git", exact: true }).count(), 1);
  await row("folder.dir").click();
  for (const next of ["git", "folder", null]) {
    await colour("alpha.txt", "success-main");
    await colour("beta.txt", "warning-main");
    await colour("folder.dir", "warning-main");
    await colour("folder.dir/child.txt", "warning-main");
    await colour("gamma.txt", "text-disabled");
    await colour("gamma.txt", "text-disabled", ".MuiListItemIcon-root");
    await colour("folder.dir", "text-secondary", ".MuiListItemIcon-root");
    await colour("other", "text-primary");
    if (next) {
      await page.getByRole("button", { name: `Switch to ${next}`, exact: true }).click();
    }
  }

  await page.evaluate(() => {
    window.fsChanges["/files"] = { changed: {}, ignored: ["folder.dir"], allIgnored: false };
    window.fsChanges["/files/folder.dir"] = { changed: {}, ignored: [], allIgnored: true };
    window.fsEmit("fs:changed", ["/files", "/files/folder.dir"]);
  });
  await colour("alpha.txt", "text-primary");
  await colour("beta.txt", "text-primary");
  await colour("gamma.txt", "text-primary");
  await colour("gamma.txt", "text-secondary", ".MuiListItemIcon-root");
  await colour("folder.dir", "text-disabled");
  await colour("folder.dir/child.txt", "text-disabled");
  await colour("folder.dir", "text-disabled", ".MuiListItemIcon-root");
  await colour("folder.dir/child.txt", "text-disabled", ".MuiListItemIcon-root");
  return "folder colours, nested changes, Git/folder switches, ignore changes and cleared changes";
}
