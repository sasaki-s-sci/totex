import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareTableCells,
  parseTable,
  TABLE_MAX_COLUMNS,
  TABLE_MAX_ROWS,
} from "../src/components/nodes/preview/tableData.ts";

test("CSV preserves quoted separators, escaped quotes, embedded newlines and empty cells", () => {
  assert.deepEqual(
    parseTable('\uFEFFname,count,note\r\n"a,b",2,"line 1\r\nline ""2"""\r\nplain,10,\r\n', ","),
    {
      rows: [
        ["name", "count", "note"],
        ["a,b", "2", 'line 1\r\nline "2"'],
        ["plain", "10", ""],
      ],
      limited: false,
      malformed: false,
    },
  );
  assert.deepEqual(parseTable('""', ",").rows, [[""]]);
  assert.deepEqual(parseTable("", ",").rows, []);
  assert.deepEqual(parseTable("a,b\n\n", ",").rows, [["a", "b"], [""]]);
});

test("TSV accepts quoted tabs and keeps commas literal", () => {
  assert.deepEqual(parseTable('a\tb\n"hello\tworld"\t1,234', "\t").rows, [
    ["a", "b"],
    ["hello\tworld", "1,234"],
  ]);
});

test("incomplete quotes are reported without losing available text", () => {
  const result = parseTable('a,b\n"open\nfield', ",");
  assert.equal(result.malformed, true);
  assert.deepEqual(result.rows, [["a", "b"], ["open\nfield"]]);
  assert.equal(parseTable('"closed"junk', ",").malformed, true);
});

test("large tables and cells are capped with a notice flag", () => {
  const rows = parseTable("row\n".repeat(TABLE_MAX_ROWS + 2), ",");
  assert.equal(rows.rows.length, TABLE_MAX_ROWS);
  assert.equal(rows.limited, true);
  const columns = parseTable(
    Array(TABLE_MAX_COLUMNS + 2)
      .fill('"a,b"')
      .join(","),
    ",",
  );
  assert.equal(columns.rows[0].length, TABLE_MAX_COLUMNS);
  assert.equal(columns.limited, true);
  const cell = parseTable("a".repeat(20001), ",");
  assert.equal(cell.rows[0][0].length, 20000);
  assert.equal(cell.limited, true);
});

test("sorting compares numeric values and natural text, keeping empty cells last", () => {
  const compare = (a, b) => compareTableCells(a, b, "asc");
  assert.deepEqual(["10", "2", "", "-4", "1.5", "2e2"].sort(compare), [
    "-4",
    "1.5",
    "2",
    "10",
    "2e2",
    "",
  ]);
  assert.deepEqual(["file10", "file2", "file1"].sort(compare), ["file1", "file2", "file10"]);
  assert.deepEqual(
    ["2", "", "10"].sort((a, b) => compareTableCells(a, b, "desc")),
    ["10", "2", ""],
  );
  assert.equal(compare("2", "2.0"), 0);
});

test("mixed numeric and text values have a consistent order and preserve equivalent input rows", () => {
  const input = ["1e2", "20x", "50", "2", "2.0", "file10", "file2", "", "  "];
  const ascending = ["2", "2.0", "50", "1e2", "20x", "file2", "file10", "", "  "];
  const descending = ["file10", "file2", "20x", "1e2", "50", "2", "2.0", "", "  "];
  for (const [direction, expected] of [
    ["asc", ascending],
    ["desc", descending],
  ]) {
    const compare = (a, b) => compareTableCells(a, b, direction);
    assert.deepEqual([...input].sort(compare), expected);
    for (let left = 0; left < expected.length; left++) {
      for (let right = left + 1; right < expected.length; right++) {
        assert.ok(compare(expected[left], expected[right]) <= 0);
      }
    }
  }
  assert.ok(compareTableCells("50", "1e999", "asc") < 0);
  assert.ok(compareTableCells("50", "Infinity", "asc") < 0);
});
