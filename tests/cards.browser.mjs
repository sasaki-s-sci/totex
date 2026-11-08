import assert from "node:assert/strict";

/** Unequal columns retain compact terminals and the row used to navigate between them. */
export async function verifyCardGeometry(page, base = "http://127.0.0.1:18422") {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(`${base}/tests/fixtures/pages.html?grouped&onlyterminals&columns`);
  const terminal = (id) => page.locator(`.card-board [data-terminal="${id}"]`);
  const card = (id) => page.locator(`[data-page-card="terminal:${id}"]`);
  await page.waitForFunction(() =>
    ["terminal-one", "terminal-two"].every(
      (id) =>
        window.pageCalls.filter((call) => call.cmd === "pty_resize" && call.args.id === id).at(-1)
          ?.args.rows === 2,
    ),
  );
  for (const id of ["terminal-one", "terminal-two"]) {
    await terminal(id).locator(".xterm-screen").click();
    await page.keyboard.press("Control+ArrowRight");
    assert.ok(
      await terminal("terminal-other").evaluate((node) => node.contains(document.activeElement)),
    );
    await page.keyboard.press("Control+ArrowLeft");
    assert.ok(
      await terminal(id).evaluate((node) => node.contains(document.activeElement)),
      "Returning from a taller neighbor keeps the original row",
    );
  }
  const left = page.locator('[data-card-folder="/tmp"]');
  const right = page.locator('[data-card-folder="/elsewhere"]');
  assert.ok(
    (await left.boundingBox()).height < 150,
    "Compact folder does not stretch to its neighbor",
  );
  assert.ok((await right.boundingBox()).height > 600);
  await card("terminal-one").getByRole("separator", { name: "Resize page height" }).focus();
  await page.keyboard.press("ArrowDown");
  assert.ok((await card("terminal-one").boundingBox()).height >= 180);
  assert.ok(
    (await card("terminal-two").boundingBox()).height < 65,
    "Expanding a sibling keeps two rows compact",
  );
  await page.keyboard.press("ArrowUp");
  assert.ok(
    (await left.boundingBox()).height < 150,
    "Collapsing returns the folder to its own height",
  );
}

/** Runs in the page-placement fixture after its terminal, editor and settings have mounted. */
export async function verifyCardLayout(page) {
  await page.evaluate(() => {
    window.cardIdentity = {
      terminal: document.querySelector('[data-terminal="terminal-one"]'),
      editor: document.querySelector('[role="textbox"][aria-label="note.txt"]'),
      settings: document.querySelector(".settings-page input"),
      attaches: window.pageCalls.filter((call) => call.cmd === "pty_attach").length,
    };
  });
  await page.getByRole("article", { name: "/tmp", exact: true }).waitFor();
  const heading = page
    .getByRole("article", { name: "/tmp", exact: true })
    .locator(".page__header .page__name");
  const initialSize = await heading.evaluate((element) =>
    parseFloat(getComputedStyle(element).fontSize),
  );
  const headers = await page
    .locator('.page-board .page__name, [data-card-folder="/tmp"] > .page__header .page__name')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        size: getComputedStyle(node).fontSize,
        weight: getComputedStyle(node).fontWeight,
      })),
    );
  assert.ok(
    headers.every((header) => header.size === headers[0].size && header.weight === "400"),
    "Folder and file headers share regular typography",
  );
  assert.equal(
    await page.locator('[data-card-folder="/tmp"] > .page__header .monitor-role').count(),
    0,
  );
  const cardSize = page.getByRole("slider", { name: "Card text size", exact: true });
  await cardSize.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction((initial) => {
    const heading = document.querySelector('[data-card-folder="/tmp"] .page__header .page__name');
    return heading && parseFloat(getComputedStyle(heading).fontSize) > initial;
  }, initialSize);
  await page.keyboard.press("ArrowLeft");

  assert.equal(
    await page.getByRole("button", { name: "Open terminal in card", exact: true }).count(),
    0,
  );
  await page.locator('.card-board [data-terminal="terminal-one"] .xterm-screen').waitFor();
  assert.ok(
    await page.evaluate(
      () =>
        window.cardIdentity.terminal ===
          document.querySelector('.card-board [data-terminal="terminal-one"]') &&
        window.cardIdentity.editor ===
          document.querySelector('.card-board [role="textbox"][aria-label="note.txt"]') &&
        window.cardIdentity.settings === document.querySelector(".card-board .settings-page input"),
    ),
    "Cards start with the mounted terminal, editor and settings",
  );
  for (const content of [
    page.getByRole("textbox", { name: "note.txt", exact: true }),
    page.locator('[data-terminal="terminal-one"]'),
  ]) {
    const card = page.locator(".resizable-page").filter({ has: content });
    const grip = card.getByRole("separator", { name: "Resize page height", exact: true });
    await grip.scrollIntoViewIfNeeded();
    const before = await card.boundingBox();
    const edge = await grip.boundingBox();
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
    await page.mouse.down();
    await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2 - 60, { steps: 5 });
    await page.mouse.up();
    const after = await card.boundingBox();
    assert.ok(Math.abs(after.height - (before.height - 60)) < 2, "Bottom edge changes height");
    assert.equal(after.width, before.width, "Height resizing preserves width");
    const resizedEdge = await grip.boundingBox();
    await page.mouse.move(
      resizedEdge.x + resizedEdge.width / 2,
      resizedEdge.y + resizedEdge.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      resizedEdge.x + resizedEdge.width / 2,
      resizedEdge.y + resizedEdge.height / 2 + 40,
      { steps: 5 },
    );
    await page.mouse.up();
    assert.ok(
      Math.abs((await card.boundingBox()).height - (after.height + 40)) < 2,
      "Dragging down grows the page",
    );
    await grip.focus();
    await page.keyboard.press("ArrowDown");
    assert.ok((await card.boundingBox()).height > after.height + 40, "Keyboard can grow the page");
  }
  // Keep both header and drop edge visible during native browser dragging.
  await page.setViewportSize({ width: 1600, height: 1600 });
  await page.locator(".card-board").evaluate((node) => {
    node.scrollTop = 0;
  });
  const card = (id) => page.locator(`[data-page-card="${id}"]`);
  for (const id of ["file:1", "folder:/tmp"]) {
    const title = card(id).locator(".page__name").first();
    await title.dblclick();
    assert.ok(
      await page.evaluate(() => window.getSelection()?.toString().length > 0),
      "Page names can be selected for copying",
    );
    assert.equal(
      await title.evaluate((node) => node.closest(".page__header, .page__drag").draggable),
      false,
    );
  }
  await page.evaluate(() => {
    document.addEventListener("dragstart", (event) => event.preventDefault(), true);
  });
  const drag = async (source, target, side) => {
    const targetCard = card(target);
    const box = await targetCard.boundingBox();
    await card(source)
      .locator(".page__header .page__name, .page__tools .page__name")
      .first()
      .dragTo(targetCard, {
        targetPosition: {
          x: side === "left" ? 4 : side === "right" ? box.width - 4 : box.width / 2,
          y: side === "top" ? 4 : side === "bottom" ? box.height - 4 : box.height / 2,
        },
      });
  };
  const layoutIs = async (rows) => {
    await page.waitForFunction((expected) => {
      const board = document.querySelector(".card-board .page-board");
      const rows = [];
      for (const card of board.children) {
        const index = Number(card.dataset.pageRow);
        rows[index] ??= [];
        rows[index].push(card.dataset.pageCard);
      }
      return JSON.stringify(rows) === JSON.stringify(expected);
    }, rows);
    assert.deepEqual(
      (await page.evaluate(() => window.pageSnapshot())).values["cards.layout"],
      rows,
    );
  };
  const settingsHeight = (await card("file:-1").boundingBox()).height;
  const folderHeight = (await card("folder:/tmp").boundingBox()).height;
  await drag("folder:/tmp", "file:-1", "right");
  await layoutIs([["file:-1", "folder:/tmp"]]);
  const fileBox = await card("file:-1").boundingBox();
  const folderBox = await card("folder:/tmp").boundingBox();
  assert.equal(fileBox.y, folderBox.y, "Settings and folder group share a row");
  assert.equal(fileBox.height, settingsHeight, "Settings keeps its own height in a row");
  assert.equal(folderBox.height, folderHeight, "The folder keeps its own height in a row");
  assert.ok(folderBox.x > fileBox.x, "Dropping the group on the right adds a column");
  const held = await card("file:-1").locator(".page__name").first().boundingBox();
  await page.mouse.move(held.x + held.width / 2, held.y + held.height / 2);
  await page.mouse.down();
  await page.mouse.move(folderBox.x + 3, folderBox.y + folderBox.height / 2, { steps: 8 });
  await page.waitForFunction(
    () => document.querySelector('[data-page-card="folder:/tmp"]').dataset.dropSide === "left",
  );
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await layoutIs([["file:-1", "folder:/tmp"]]);
  await page.waitForFunction(() => !document.querySelector("[data-drop-side]"));
  await drag("folder:/tmp", "file:-1", "bottom");
  await layoutIs([["file:-1"], ["folder:/tmp"]]);
  await card("folder:/tmp").locator(":scope > .folder-card > .page__header").focus();
  await page.keyboard.press("Alt+ArrowLeft");
  await layoutIs([["folder:/tmp", "file:-1"]]);
  await drag("file:-1", "folder:/tmp", "top");
  await layoutIs([["file:-1"], ["folder:/tmp"]]);
  // A file and terminal share the folder's inner layout and keep their live content.
  const fileHeight = (await card("file:1").locator(".resizable-page").boundingBox()).height;
  const terminalHeight = (
    await card("terminal:terminal-one").locator(".resizable-page").boundingBox()
  ).height;
  await drag("file:1", "terminal:terminal-one", "right");
  const file = await card("file:1").boundingBox();
  const terminalBox = await card("terminal:terminal-one").boundingBox();
  assert.equal(file.y, terminalBox.y);
  assert.equal((await card("file:1").locator(".resizable-page").boundingBox()).height, fileHeight);
  assert.equal(
    (await card("terminal:terminal-one").locator(".resizable-page").boundingBox()).height,
    terminalHeight,
    "A neighboring file does not stretch the terminal",
  );
  assert.ok(file.x > terminalBox.x);
  const editor = page.getByRole("textbox", { name: "note.txt", exact: true });
  const terminal = card("terminal:terminal-one").locator("[data-terminal]");
  await editor.click();
  for (const key of ["Control+ArrowLeft", "Control+ArrowLeft"]) {
    await page.keyboard.press(key);
    assert.ok(await terminal.evaluate((node) => node.contains(document.activeElement)));
  }
  for (const key of ["Control+ArrowRight", "Control+ArrowRight"]) {
    await page.keyboard.press(key);
    assert.ok(await editor.evaluate((node) => node === document.activeElement));
  }
  assert.equal(await page.locator("#cli-sidebar").isVisible(), false, "The edge opens no viewer");
  const tools = await card("file:1").locator(".page__tools").boundingBox();
  const body = await card("file:1").locator(".page__body").boundingBox();
  assert.ok(tools.x >= body.x + body.width - 1, "File header controls are on the right");
  assert.equal(await card("file:1").locator(".page-terminal-number").textContent(), "2");
  await drag("file:1", "terminal:terminal-one", "left");
  await editor.click();
  await page.keyboard.press("Control+ArrowRight");
  assert.ok(await terminal.evaluate((node) => node.contains(document.activeElement)));
  await page.keyboard.press("Control+ArrowLeft");
  assert.ok(await editor.evaluate((node) => node === document.activeElement));
  await drag("file:1", "terminal:terminal-one", "bottom");
  const beforeHeight = (await card("file:1").boundingBox()).height;
  await card("file:1").getByRole("separator", { name: "Resize page height" }).focus();
  await page.keyboard.press("ArrowDown");
  assert.equal((await card("file:1").boundingBox()).height, beforeHeight + 16);
  assert.equal(
    await page.getByRole("textbox", { name: "note.txt", exact: true }).textContent(),
    "saved text",
  );
  assert.ok(
    await page.evaluate(
      () =>
        window.cardIdentity.editor ===
          document.querySelector('[role="textbox"][aria-label="note.txt"]') &&
        window.cardIdentity.settings === document.querySelector(".settings-page input"),
    ),
    "Reordering keeps the editor and settings mounted",
  );
  assert.ok(
    await page.evaluate(
      () =>
        window.cardIdentity.terminal === document.querySelector('[data-terminal="terminal-one"]') &&
        window.cardIdentity.attaches ===
          window.pageCalls.filter((call) => call.cmd === "pty_attach").length,
    ),
    "Resizing does not recreate the terminal or reattach its shell",
  );
  await page.setViewportSize({ width: 1600, height: 1000 });
  const scrollSpace = await page.locator(".card-board").evaluate((board) => {
    board.scrollTop = board.scrollHeight;
    const viewport = board.getBoundingClientRect();
    const content = board.querySelector(":scope > .page-board").getBoundingClientRect();
    const space = viewport.bottom - content.bottom;
    board.scrollTop = 0;
    return { space, height: board.clientHeight };
  });
  assert.ok(
    Math.abs(scrollSpace.space - scrollSpace.height / 2) < 20,
    "Canvas can scroll half a viewport beyond its final page",
  );
  await page
    .locator(".cli-page")
    .getByRole("button", { name: "Open main in sidebar viewer", exact: true })
    .click();
  await page.locator('#cli-sidebar [data-terminal="terminal-one"] .xterm-screen').waitFor();
}

/** Uses the native IPC stub installed by the page-placement fixture. */
export async function verifyCardOffers(page, base = "http://127.0.0.1:18422") {
  await page.goto(`${base}/tests/fixtures/pages.html?offers`);
  await page.locator('[data-card-folder="/empty-a"]').waitFor();
  await page.locator('[data-terminal="terminal-one"] .xterm-screen').click();
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-card-offered]")?.getAttribute("data-card-folder") ===
      "/empty-a",
  );
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(
    () =>
      document.querySelector("[data-card-offered]")?.getAttribute("data-card-folder") ===
      "/empty-b",
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(() =>
    window.pageCalls.some((call) => call.cmd === "pty_open" && call.args.cwd === "/empty-b"),
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, shiftKey: true, repeat: true }),
    ),
  );
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
  assert.equal(await page.locator("[data-card-offered]").count(), 0);
  assert.equal(
    await page.evaluate(
      () =>
        window.pageCalls.filter((call) => call.cmd === "pty_open" && call.args.cwd === "/empty-a")
          .length,
    ),
    0,
  );
  // Ordinary editor selections keep Ctrl+Shift; they must not offer a terminal.
  await page.getByRole("textbox", { name: "note.txt", exact: true }).click();
  await page.keyboard.down("Control");
  await page.keyboard.down("Shift");
  assert.equal(await page.locator("[data-card-offered]").count(), 0);
  await page.keyboard.up("Shift");
  await page.keyboard.up("Control");
}

/** Same-folder terminals share one header while keeping independent live runtimes and controls. */
export async function verifyFolderGroups(page, base = "http://127.0.0.1:18422") {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await page.goto(`${base}/tests/fixtures/pages.html?grouped&onlyterminals`);
  const group = page.locator('[data-card-folder="/tmp"]');
  const other = page.locator('[data-card-folder="/elsewhere"]');
  const terminal = (id) => page.locator(`.card-board [data-terminal="${id}"]`);
  const card = (id) => page.locator(`[data-page-card="terminal:${id}"]`);
  const rows = async (id, wanted) => {
    await page.waitForFunction(
      ({ id, wanted }) =>
        window.pageCalls.filter((call) => call.cmd === "pty_resize" && call.args.id === id).at(-1)
          ?.args.rows === wanted,
      { id, wanted },
    );
  };
  await group.waitFor();
  await other.waitFor();
  for (const id of ["terminal-one", "terminal-two", "terminal-other"]) {
    await terminal(id).locator(".xterm-screen").waitFor();
    await rows(id, 2);
  }
  for (const [id, number] of [
    ["terminal-one", "1"],
    ["terminal-two", "2"],
    ["terminal-other", "3"],
  ]) {
    assert.equal(await card(id).locator(".page-terminal-number").textContent(), number);
  }
  assert.equal(await group.locator(".page__header").count(), 1, "One header for the folder");
  assert.equal(await group.locator(".cli-page .page__header").count(), 0);
  assert.equal(await group.locator("[data-terminal]").count(), 2);
  assert.equal(await other.locator("[data-terminal]").count(), 1);
  const stacked = await group.locator("[data-page-card]").evaluateAll((rows) =>
    rows.map((row) => ({
      gap: getComputedStyle(row).gap,
      borderTop: getComputedStyle(row).borderTopWidth,
      top: row.getBoundingClientRect().top,
      bottom: row.getBoundingClientRect().bottom,
    })),
  );
  assert.equal(stacked[1].borderTop, "1px", "Stacked terminals have a separator line");
  assert.ok(
    Math.abs(stacked[1].top - stacked[0].bottom) < 1,
    "Panels share one outer card without gaps",
  );
  assert.equal(
    await group
      .locator(".cli-page")
      .first()
      .evaluate((node) => getComputedStyle(node).boxShadow),
    "none",
  );
  await page.evaluate(() => {
    window.groupIdentity = {
      opens: window.pageCalls.filter((call) => call.cmd === "pty_open").length,
      one: document.querySelector('[data-terminal="terminal-one"]'),
      two: document.querySelector('[data-terminal="terminal-two"]'),
      header: document.querySelector('[data-card-folder="/tmp"] > .page__header'),
      attaches: window.pageCalls.filter((call) => call.cmd === "pty_attach").length,
    };
  });
  for (const [id, text] of [
    ["terminal-one", "first-group-input"],
    ["terminal-two", "second-group-input"],
  ]) {
    await terminal(id).locator(".xterm-screen").click();
    await page.keyboard.type(text);
    await page.waitForFunction(
      ({ id, text }) =>
        window.pageCalls
          .filter((call) => call.cmd === "pty_write" && call.args.id === id)
          .map((call) => call.args.data)
          .join("")
          .includes(text),
      { id, text },
    );
    const rail = card(id).locator(".page__tools");
    assert.equal(await rail.locator("button").count(), 2, "Only viewer and close controls remain");
    assert.equal(await rail.evaluate((node) => getComputedStyle(node).borderLeftWidth), "0px");
    const controls = await rail.locator("button").evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      }),
    );
    assert.equal(controls[0].x, controls[1].x, "Controls form one vertical column");
    assert.ok(controls[1].y >= controls[0].y + controls[0].height - 1);
    const tools = await card(id).locator(".page__tools").boundingBox();
    const body = await terminal(id).boundingBox();
    assert.ok(tools.x >= body.x + body.width - 1, "Controls sit beside the terminal");
  }
  await card("terminal-one")
    .getByRole("button", { name: "Open main in sidebar viewer", exact: true })
    .click();
  assert.ok(
    await page
      .locator('#cli-sidebar [data-terminal="terminal-one"]')
      .evaluate((node) => node.contains(document.activeElement)),
    "The viewer control opens and focuses the selected terminal in the sidebar",
  );
  for (const [key, id] of [
    ["Control+ArrowDown", "terminal-two"],
    ["Control+ArrowDown", "terminal-other"],
    ["Control+ArrowUp", "terminal-two"],
    ["Control+1", "terminal-one"],
    ["Control+3", "terminal-other"],
    ["Control+2", "terminal-two"],
  ]) {
    await page.keyboard.press(key);
    await page.waitForFunction(
      async (id) => (await window.pageSnapshot()).values["sessions.active"] === id,
      id,
    );
    assert.ok(
      await page
        .locator(`#cli-sidebar [data-terminal="${id}"]`)
        .evaluate((node) => node.contains(document.activeElement)),
      `${key} displays and focuses ${id} in the sidebar`,
    );
  }
  await terminal("terminal-one").locator(".xterm-screen").click();
  assert.ok(
    await terminal("terminal-one").evaluate((node) => node.contains(document.activeElement)),
    "The card remains independently focusable while its viewer is open",
  );
  await page.keyboard.press("Control+ArrowRight");
  assert.ok(
    await page
      .locator('#cli-sidebar [data-terminal="terminal-two"]')
      .evaluate((node) => node.contains(document.activeElement)),
    "Ctrl+Right reaches the visible sidebar and skips its hidden terminals",
  );
  await page.getByRole("button", { name: "Hide page sidebar", exact: true }).click();
  await card("terminal-two")
    .getByRole("separator", { name: "Resize page height", exact: true })
    .focus();
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction(
    () =>
      window.pageCalls
        .filter((call) => call.cmd === "pty_resize" && call.args.id === "terminal-two")
        .at(-1)?.args.rows > 2,
  );
  await rows("terminal-one", 2);
  assert.equal(await group.locator(".page__header").count(), 1, "Expanding adds no header");
  await card("terminal-two")
    .getByRole("separator", { name: "Resize page height", exact: true })
    .focus();
  await page.keyboard.press("ArrowUp");
  await rows("terminal-two", 2);
  const resizeWorker = async (delta) => {
    const grip = await card("terminal-two")
      .getByRole("separator", {
        name: "Resize page height",
        exact: true,
      })
      .boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2 + delta, { steps: 6 });
    await page.mouse.up();
  };
  await resizeWorker(200);
  await page.waitForFunction(
    () =>
      window.pageCalls
        .filter((call) => call.cmd === "pty_resize" && call.args.id === "terminal-two")
        .at(-1)?.args.rows > 2,
  );
  await resizeWorker(-220);
  await rows("terminal-two", 2);

  assert.equal(
    await page.evaluate(() => window.pageCalls.filter((call) => call.cmd === "pty_attach").length),
    await page.evaluate(() => window.groupIdentity.attaches + 3),
    "Opening three viewers adds only their own connections",
  );
  await group.evaluate((node) => {
    window.movingCard = node.querySelector('[data-page-card="terminal:terminal-two"]');
    window.movingSlot = window.movingCard.querySelector(".page-slot");
    window.targetCard = node.querySelector('[data-page-card="terminal:terminal-one"]');
  });
  const target = card("terminal-one");
  const box = await target.boundingBox();
  await card("terminal-two")
    .locator(".page__drag")
    .dragTo(target, {
      sourcePosition: { x: 1, y: 10 },
      targetPosition: { x: 4, y: box.height / 2 },
    });
  await page.waitForFunction(
    async () =>
      JSON.stringify((await window.pageSnapshot()).values["cards.layout./tmp"]) ===
      JSON.stringify([["terminal:terminal-two", "terminal:terminal-one"]]),
  );
  assert.ok(
    await card("terminal-two").evaluate(
      (node) =>
        node === window.movingCard && node.querySelector(".page-slot") === window.movingSlot,
    ),
    "Reordering preserves the card and its mounted page host",
  );
  assert.ok(
    await card("terminal-one").evaluate((node) => node === window.targetCard),
    "Reordering also preserves the destination card",
  );
  const one = await card("terminal-one").boundingBox();
  const two = await card("terminal-two").boundingBox();
  assert.equal(one.y, two.y);
  assert.ok(two.x < one.x, "Terminals reorder inside their folder");
  await page.waitForFunction(
    () =>
      document.querySelector('[data-page-card="terminal:terminal-two"] .page-terminal-number')
        ?.textContent === "1",
  );
  assert.equal(await card("terminal-one").locator(".page-terminal-number").textContent(), "2");
  assert.equal(await card("terminal-two").locator(".page-terminal-number").textContent(), "1");
  assert.ok(Math.abs(one.x - two.x - two.width) < 1, "Columns share a divider without gaps");
  assert.equal(
    await card("terminal-one").evaluate((node) => getComputedStyle(node).borderLeftWidth),
    "1px",
  );
  assert.equal(await group.locator(".page__header").count(), 1);

  // StrictMode replays effects on reordered fibers; reopening an existing viewer must not.
  await page.evaluate(() => {
    window.groupIdentity.afterReorder = window.pageCalls.filter(
      (call) => call.cmd === "pty_attach",
    ).length;
  });
  await card("terminal-two").locator("button.page-terminal-number").click();
  const viewer = page.locator('#cli-sidebar [data-terminal="terminal-two"]');
  await viewer.waitFor();
  assert.ok(
    await viewer.evaluate((node) => node.contains(document.activeElement)),
    "Clicking a terminal number focuses its sidebar viewer",
  );
  assert.equal(await viewer.getAttribute("data-terminal-viewer"), "true");
  assert.equal(
    await page
      .locator('#cli-sidebar .cli-page:has([data-terminal="terminal-two"])')
      .locator(".page-terminal-number")
      .count(),
    0,
    "Viewer has no terminal number element",
  );
  await page.waitForFunction(
    () =>
      window.pageCalls
        .filter((call) => call.cmd === "pty_resize" && call.args.id === "terminal-two")
        .at(-1)?.args.rows > 2,
  );
  await viewer.locator(".xterm-screen").click();
  await page.keyboard.type("viewer-input");
  await page.waitForFunction(() =>
    window.pageCalls
      .filter((call) => call.cmd === "pty_write" && call.args.id === "terminal-two")
      .map((call) => call.args.data)
      .join("")
      .includes("viewer-input"),
  );
  await terminal("terminal-two").locator(".xterm-screen").click();
  await page.keyboard.type("source-with-viewer");
  await page.waitForFunction(() =>
    window.pageCalls
      .filter((call) => call.cmd === "pty_write" && call.args.id === "terminal-two")
      .map((call) => call.args.data)
      .join("")
      .includes("source-with-viewer"),
  );
  await page.evaluate(() =>
    window.pageEmit("pty:data", {
      id: "terminal-two",
      data: "\x1b[2J\x1b[HSHAREDOUTPUT",
      seq: 1,
    }),
  );
  await page.waitForTimeout(100);
  for (const surface of [terminal("terminal-two"), viewer]) {
    await surface.locator(".xterm-screen").click({ position: { x: 4, y: 6 }, clickCount: 3 });
    const copies = await page.evaluate(
      () =>
        window.pageCalls.filter((call) => call.cmd === "plugin:clipboard-manager|write_text")
          .length,
    );
    await page.keyboard.press("Control+Shift+c");
    await page.waitForFunction((before) => {
      const copied = window.pageCalls.filter(
        (call) => call.cmd === "plugin:clipboard-manager|write_text",
      );
      return copied.length > before && copied.at(-1).args.text.trim() === "SHAREDOUTPUT";
    }, copies);
  }
  for (const [query, reply] of [
    ["\x1b[6n", "\x1b["],
    ["\x1b]11;?\x07", "\x1b]11;"],
  ]) {
    const before = await page.evaluate(() => window.pageCalls.length);
    await page.evaluate(
      (data) => window.pageEmit("pty:data", { id: "terminal-two", data, seq: 2 }),
      query,
    );
    await page.waitForFunction(
      ({ before, reply }) =>
        window.pageCalls
          .slice(before)
          .some((call) => call.cmd === "pty_write" && call.args.data.startsWith(reply)),
      { before, reply },
    );
    await page.waitForTimeout(100);
    assert.equal(
      await page.evaluate(
        ({ before, reply }) =>
          window.pageCalls
            .slice(before)
            .filter((call) => call.cmd === "pty_write")
            .map((call) => call.args.data)
            .join("")
            .split(reply).length - 1,
        { before, reply },
      ),
      1,
      "Only the viewer replies to terminal queries",
    );
  }
  await page.setViewportSize({ width: 1550, height: 1500 });
  await page.waitForTimeout(250);
  assert.ok(
    await page.evaluate(
      () =>
        window.pageCalls
          .filter((call) => call.cmd === "pty_resize" && call.args.id === "terminal-two")
          .at(-1)?.args.rows > 2,
    ),
    "The viewer owns PTY size while the source card stays compact",
  );
  assert.equal(
    await page.evaluate(() => window.pageCalls.filter((call) => call.cmd === "pty_open").length),
    await page.evaluate(() => window.groupIdentity.opens),
    "Opening a viewer starts no second process",
  );
  assert.equal(await group.locator("[data-terminal]").count(), 2);
  assert.equal(await group.locator(".page__header").count(), 1);
  await page
    .locator("#cli-sidebar")
    .getByRole("button", { name: "Close worker viewer", exact: true })
    .click();
  await group.locator('[data-terminal="terminal-two"]').waitFor();
  await rows("terminal-two", 2);
  assert.equal(
    await page.evaluate(() => window.pageCalls.filter((call) => call.cmd === "pty_close").length),
    0,
    "Closing a viewer keeps its process running",
  );
  assert.ok(
    await page.evaluate(
      () =>
        window.groupIdentity.one === document.querySelector('[data-terminal="terminal-one"]') &&
        window.groupIdentity.two === document.querySelector('[data-terminal="terminal-two"]') &&
        window.groupIdentity.header ===
          document.querySelector('[data-card-folder="/tmp"] > .page__header') &&
        window.groupIdentity.afterReorder ===
          window.pageCalls.filter((call) => call.cmd === "pty_attach").length,
    ),
    "Reopening a viewer preserves source runtimes, connections and the shared header",
  );
  await card("terminal-two").getByRole("button", { name: "Close worker", exact: true }).click();
  await terminal("terminal-two").waitFor({ state: "detached" });
  assert.equal(await group.locator("[data-terminal]").count(), 1);
  assert.equal(await group.locator(".page__header").count(), 1);
  assert.deepEqual(
    await page.evaluate(() =>
      window.pageCalls.filter((call) => call.cmd === "pty_close").map((call) => call.args.id),
    ),
    ["terminal-two"],
  );
  await page.evaluate(() => {
    window.pageAgent = true;
  });
  await card("terminal-one").locator(".page-agent .monitor-badge").waitFor();
  assert.equal(await card("terminal-one").locator(".monitor-badge__row").count(), 2);
  assert.equal(await terminal("terminal-one").count(), 1, "Agent summary retains its terminal");
  const agentPage = card("terminal-one").locator(".cli-page");
  const workers = agentPage.locator(".page-agent-workers");
  await workers.locator('[data-kind="subagent"]').waitFor();
  assert.equal(await workers.locator('[data-kind="subagent"]').textContent(), "2");
  assert.equal(await workers.locator('[data-kind="background"]').textContent(), "1");
  assert.equal(await group.locator(":scope > .page__header .monitor-role").count(), 0);
  assert.equal(
    await card("terminal-other").locator(".page-agent-workers .monitor-role").count(),
    0,
  );
  assert.equal(
    await agentPage.locator(".page-agent .monitor-badge__count").count(),
    0,
    "Agent workers appear once beside their own content",
  );
  const checkWorkers = async () => {
    const geometry = await agentPage.evaluate((node) => {
      const body = node.querySelector(".page__body").getBoundingClientRect();
      const content = node.querySelector(".page-terminal-content").getBoundingClientRect();
      const workers = node.querySelector(".page-agent-workers").getBoundingClientRect();
      return {
        contentRight: content.right,
        workerLeft: workers.left,
        workerBottom: workers.bottom,
        bodyBottom: body.bottom,
        workerRight: workers.right,
        bodyRight: body.right,
      };
    });
    assert.ok(
      geometry.contentRight <= geometry.workerLeft + 1,
      "Text reserves the worker column width",
    );
    assert.ok(
      Math.abs(geometry.bodyBottom - geometry.workerBottom - 4) < 2,
      "Workers sit at the bottom",
    );
    assert.ok(
      Math.abs(geometry.bodyRight - geometry.workerRight - 8) < 2,
      "Workers sit at the right",
    );
  };
  await checkWorkers();
  const longText = agentPage.locator(".monitor-badge__summary").first();
  assert.ok(await longText.evaluate((node) => node.scrollWidth > node.clientWidth));
  assert.equal(await longText.evaluate((node) => getComputedStyle(node).textOverflow), "ellipsis");

  await card("terminal-one")
    .getByRole("separator", { name: "Resize page height", exact: true })
    .focus();
  await page.keyboard.press("ArrowDown");
  await card("terminal-one").locator(".page-agent").waitFor({ state: "detached" });
  assert.equal(
    await terminal("terminal-one").evaluate((node) => node === window.groupIdentity.one),
    true,
  );
  await checkWorkers();
  await terminal("terminal-one").locator(".xterm-screen").click();
  await card("terminal-one")
    .getByRole("separator", { name: "Resize page height", exact: true })
    .focus();
  await page.keyboard.press("ArrowUp");
  await card("terminal-one").locator(".page-agent .monitor-badge").waitFor();
  await page.evaluate(() => {
    window.pageNoWorkers = true;
  });
  await workers.locator(".monitor-role").first().waitFor({ state: "detached" });
  assert.equal(
    await workers.evaluate((node) => node.getBoundingClientRect().width),
    0,
    "An agent without workers reserves no empty gutter",
  );
  await page.evaluate(() => {
    window.pageAgent = false;
  });
  await card("terminal-one").locator(".page-agent").waitFor({ state: "detached" });
  await card("terminal-one").locator("button.page-terminal-number").focus();
  await page.keyboard.press("Enter");
  await page.locator('#cli-sidebar [data-terminal="terminal-one"]').waitFor();
  await page.evaluate(() => window.pageEmit("pty:exit", "terminal-one"));
  await page.waitForFunction(() => !document.querySelector('[data-terminal="terminal-one"]'));
  assert.equal(
    await page.evaluate(
      () =>
        window.pageCalls.filter(
          (call) => call.cmd === "pty_close" && call.args.id === "terminal-one",
        ).length,
    ),
    0,
    "A shared process exit removes the session without another close request",
  );
  assert.equal(await terminal("terminal-other").count(), 1);
  await page.setViewportSize({ width: 1600, height: 1000 });
  return "one folder header, independent two-row input/expansion, right controls, nested reorder, additive viewer, shared output, single exit and close";
}
