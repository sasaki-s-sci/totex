import assert from "node:assert/strict";
import { test } from "node:test";
import { customizeValidator } from "@rjsf/validator-ajv8";
import { DEFAULT_SETTINGS } from "../src/lib/appSettingsModel.ts";
import { totexSchema } from "../src/lib/totexSchema.ts";

test("totex schema accepts app defaults and preserves extension properties", () => {
  const validator = customizeValidator({});
  const value = { ...DEFAULT_SETTINGS, extension: { enabled: true } };
  const before = structuredClone(value);
  assert.equal(validator.isValid(totexSchema, value, totexSchema), true);
  assert.deepEqual(value, before);
});

test("totex schema rejects invalid dropdown values and numeric bounds", () => {
  const validator = customizeValidator({});
  for (const patch of [{ theme: "blue" }, { readingSize: 100 }, { said: { lines: 0 } }]) {
    assert.equal(
      validator.isValid(totexSchema, { ...DEFAULT_SETTINGS, ...patch }, totexSchema),
      false,
    );
  }
});

test("attached schemas support local references, arrays and required fields", () => {
  const validator = customizeValidator({});
  const schema = {
    type: "object",
    required: ["items"],
    definitions: { choice: { type: "string", enum: ["a", "b"] } },
    properties: { items: { type: "array", minItems: 1, items: { $ref: "#/definitions/choice" } } },
  };
  assert.equal(validator.isValid(schema, { items: ["a"] }, schema), true);
  for (const value of [{}, { items: [] }, { items: ["c"] }]) {
    assert.equal(validator.isValid(schema, value, schema), false);
  }
  assert.ok(validator.rawValidation({ $ref: "https://example.com/missing" }).validationError);
});
