import { describe, expect, it } from "vitest";
import { defineSchema } from "./schema";
import { validate } from "./validate";

describe("validate", () => {
  it("reports missing required properties and respects optional fields", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        position: {
          type: "tuple",
          items: [{ type: "number" }, { type: "number" }, { type: "number" }],
        },
        name: { type: "optional", inner: { type: "string" } },
      },
    });

    const issues = validate(schema, {});

    expect(issues).toEqual([
      { path: "$.position", message: "Missing required property" },
    ]);
  });

  it("flags unknown object properties by default", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        name: { type: "string" },
      },
    });

    const issues = validate(schema, { name: "ok", extra: 1 });

    expect(issues).toEqual([
      { path: "$.extra", message: "Unknown property" },
    ]);
  });

  it("allows unknown object properties when configured", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        name: { type: "string" },
      },
    });

    const issues = validate(
      schema,
      { name: "ok", extra: 1 },
      { allowUnknownProperties: true }
    );

    expect(issues).toEqual([]);
  });

  it("validates tuple length and item types", () => {
    const schema = defineSchema({
      type: "tuple",
      items: [{ type: "number" }, { type: "number" }, { type: "number" }],
    });

    const issues = validate(schema, [1, "nope"]);

    expect(issues).toEqual([
      { path: "$", message: "Expected tuple length 3" },
      { path: "$[1]", message: "Expected number" },
    ]);
  });

  it("reports deep paths for nested structures", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "tuple",
            items: [{ type: "number" }, { type: "number" }, { type: "number" }],
          },
        },
      },
    });

    const issues = validate(schema, { items: [[1, 2, "bad"]] });
    expect(issues).toEqual([{ path: "$.items[0][2]", message: "Expected number" }]);
  });

  it("collects multiple issues across sibling fields", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        name: { type: "string", minLength: 2 },
        count: { type: "number", min: 1 },
        active: { type: "boolean" },
      },
    });

    const issues = validate(schema, { name: "x", count: 0, active: "yes" });
    expect(issues).toEqual([
      { path: "$.name", message: "Expected min length 2" },
      { path: "$.count", message: "Expected number >= 1" },
      { path: "$.active", message: "Expected boolean" },
    ]);
  });

  it("validates arrays with size limits and item schemas", () => {
    const schema = defineSchema({
      type: "array",
      items: { type: "number" },
      minItems: 2,
      maxItems: 3,
    });

    const issues = validate(schema, [1, "bad", 3, 4]);

    expect(issues).toEqual([
      { path: "$", message: "Expected at most 3 items" },
      { path: "$[1]", message: "Expected number" },
    ]);
  });

  it("reports tuple length errors when extra items are present", () => {
    const schema = defineSchema({
      type: "tuple",
      items: [{ type: "number" }, { type: "string" }],
    });

    const issues = validate(schema, [1, 2, 3]);
    expect(issues).toEqual([
      { path: "$", message: "Expected tuple length 2" },
      { path: "$[1]", message: "Expected string" },
    ]);
  });

  it("rejects non-array values for array and tuple schemas", () => {
    const arraySchema = defineSchema({
      type: "array",
      items: { type: "string" },
    });
    const tupleSchema = defineSchema({
      type: "tuple",
      items: [{ type: "number" }, { type: "number" }],
    });

    expect(validate(arraySchema, "nope")).toEqual([
      { path: "$", message: "Expected array" },
    ]);
    expect(validate(tupleSchema, { 0: 1, 1: 2 })).toEqual([
      { path: "$", message: "Expected array" },
    ]);
  });

  it("validates tagged unions and surfaces variant errors", () => {
    const schema = defineSchema({
      type: "taggedUnion",
      tag: "kind",
      variants: {
        box: {
          type: "object",
          properties: {
            kind: { type: "literal", value: "box" },
            size: {
              type: "tuple",
              items: [{ type: "number" }, { type: "number" }, { type: "number" }],
            },
          },
        },
        sphere: {
          type: "object",
          properties: {
            kind: { type: "literal", value: "sphere" },
            radius: { type: "number", min: 0 },
          },
        },
      },
    });

    const unknownTag = validate(schema, { kind: "capsule", radius: 1 });
    expect(unknownTag).toEqual([
      { path: "$.kind", message: "Unknown tag \"capsule\"" },
    ]);

    const variantIssues = validate(schema, { kind: "sphere", radius: -2 });
    expect(variantIssues).toEqual([
      { path: "$.radius", message: "Expected number >= 0" },
    ]);
  });

  it("reports missing required fields within tagged union variants", () => {
    const schema = defineSchema({
      type: "taggedUnion",
      tag: "kind",
      variants: {
        box: {
          type: "object",
          properties: {
            kind: { type: "literal", value: "box" },
            size: {
              type: "tuple",
              items: [{ type: "number" }, { type: "number" }, { type: "number" }],
            },
          },
        },
      },
    });

    const issues = validate(schema, { kind: "box" });
    expect(issues).toEqual([
      { path: "$.size", message: "Missing required property" },
    ]);
  });

  it("rejects tagged unions with non-string tags", () => {
    const schema = defineSchema({
      type: "taggedUnion",
      tag: "kind",
      variants: {
        box: {
          type: "object",
          properties: {
            kind: { type: "literal", value: "box" },
            size: {
              type: "tuple",
              items: [{ type: "number" }, { type: "number" }, { type: "number" }],
            },
          },
        },
      },
    });

    const issues = validate(schema, { kind: 123, size: [1, 2, 3] });
    expect(issues).toEqual([
      { path: "$.kind", message: "Expected tag \"kind\" to be a string" },
    ]);
  });

  it("validates map entries and reports per-key paths", () => {
    const schema = defineSchema({
      type: "map",
      values: { type: "number", integer: true },
    });

    const issues = validate(schema, { ok: 1, bad: 1.5 });

    expect(issues).toEqual([
      { path: "$.bad", message: "Expected integer" },
    ]);
  });

  it("formats paths for non-identifier object keys", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        "foo-bar": { type: "number" },
        "space key": { type: "string" },
      },
    });

    const issues = validate(schema, {});
    expect(issues).toEqual([
      { path: "$[\"foo-bar\"]", message: "Missing required property" },
      { path: "$[\"space key\"]", message: "Missing required property" },
    ]);
  });

  it("formats paths for non-identifier map keys", () => {
    const schema = defineSchema({
      type: "map",
      values: { type: "number" },
    });

    const issues = validate(schema, { "bad-key": "nope" });
    expect(issues).toEqual([
      { path: "$[\"bad-key\"]", message: "Expected number" },
    ]);
  });

  it("rejects non-object values for object and map schemas", () => {
    const objectSchema = defineSchema({
      type: "object",
      properties: { label: { type: "string" } },
    });
    const mapSchema = defineSchema({
      type: "map",
      values: { type: "number" },
    });

    expect(validate(objectSchema, null)).toEqual([
      { path: "$", message: "Expected object" },
    ]);
    expect(validate(mapSchema, [1, 2, 3])).toEqual([
      { path: "$", message: "Expected object" },
    ]);
  });

  it("validates booleans and optional fields", () => {
    const booleanSchema = defineSchema({ type: "boolean" });
    const optionalNumberSchema = defineSchema({
      type: "optional",
      inner: { type: "number" },
    });

    const boolIssues = validate(booleanSchema, "true");
    expect(boolIssues).toEqual([{ path: "$", message: "Expected boolean" }]);

    const optionalMissing = validate(optionalNumberSchema, undefined);
    expect(optionalMissing).toEqual([]);

    const optionalIssues = validate(optionalNumberSchema, "nope");
    expect(optionalIssues).toEqual([{ path: "$", message: "Expected number" }]);
  });

  it("still validates optional values when present", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        note: { type: "optional", inner: { type: "string", minLength: 2 } },
      },
    });

    const issues = validate(schema, { note: "x" });
    expect(issues).toEqual([
      { path: "$.note", message: "Expected min length 2" },
    ]);
  });

  it("allows optional object properties to be omitted or undefined", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        title: { type: "string" },
        note: { type: "optional", inner: { type: "string" } },
      },
    });

    const missingOptional = validate(schema, { title: "Hello" });
    expect(missingOptional).toEqual([]);

    const undefinedOptional = validate(schema, { title: "Hello", note: undefined });
    expect(undefinedOptional).toEqual([]);
  });

  it("validates tag schemas accept true", () => {
    const tagSchema = defineSchema({ type: "tag" });

    expect(validate(tagSchema, true)).toEqual([]);
    expect(validate(tagSchema, false)).toEqual([
      { path: "$", message: "Expected true" },
    ]);
    expect(validate(tagSchema, "yes")).toEqual([
      { path: "$", message: "Expected true" },
    ]);
    expect(validate(tagSchema, undefined)).toEqual([
      { path: "$", message: "Expected true" },
    ]);
  });

  it("validates enums and literals", () => {
    const enumSchema = defineSchema({
      type: "enum",
      values: ["idle", "run", "jump"] as const,
    });
    const literalSchema = defineSchema({
      type: "literal",
      value: "player",
    });

    const enumIssues = validate(enumSchema, "fly");
    expect(enumIssues).toEqual([
      { path: "$", message: "Expected one of idle, run, jump" },
    ]);

    const literalIssues = validate(literalSchema, "npc");
    expect(literalIssues).toEqual([
      { path: "$", message: "Expected literal \"player\"" },
    ]);
  });

  it("rejects enums when given non-string values", () => {
    const enumSchema = defineSchema({
      type: "enum",
      values: ["idle", "run"] as const,
    });

    const issues = validate(enumSchema, 123);
    expect(issues).toEqual([{ path: "$", message: "Expected one of idle, run" }]);
  });

  it("accepts valid enums and literals", () => {
    const enumSchema = defineSchema({
      type: "enum",
      values: ["idle", "run"] as const,
    });
    const literalSchema = defineSchema({
      type: "literal",
      value: "hero",
    });

    expect(validate(enumSchema, "run")).toEqual([]);
    expect(validate(literalSchema, "hero")).toEqual([]);
  });

  it("validates object property constraints", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        label: { type: "string", minLength: 2 },
        value: { type: "number", max: 10 },
      },
    });

    const issues = validate(schema, { label: "x", value: 11 });

    expect(issues).toEqual([
      { path: "$.label", message: "Expected min length 2" },
      { path: "$.value", message: "Expected number <= 10" },
    ]);
  });

  it("enforces numeric min/max bounds", () => {
    const schema = defineSchema({
      type: "number",
      min: 0,
      max: 5,
    });

    const minIssues = validate(schema, -1);
    expect(minIssues).toEqual([{ path: "$", message: "Expected number >= 0" }]);

    const maxIssues = validate(schema, 6);
    expect(maxIssues).toEqual([{ path: "$", message: "Expected number <= 5" }]);
  });

  it("validates string constraints (length + pattern)", () => {
    const schema = defineSchema({
      type: "string",
      minLength: 3,
      maxLength: 5,
      pattern: "^[a-z]+$",
    });

    const issues = validate(schema, "A1");
    expect(issues).toEqual([
      { path: "$", message: "Expected min length 3" },
      { path: "$", message: "Expected string to match pattern ^[a-z]+$" },
    ]);
  });

  it("handles regex patterns with escapes", () => {
    const schema = defineSchema({
      type: "string",
      pattern: "^\\d{3}-\\d{2}$",
    });

    expect(validate(schema, "123-45")).toEqual([]);
    expect(validate(schema, "12345")).toEqual([
      { path: "$", message: "Expected string to match pattern ^\\d{3}-\\d{2}$" },
    ]);
  });

  it("enforces string max length", () => {
    const schema = defineSchema({
      type: "string",
      maxLength: 3,
    });

    const issues = validate(schema, "hello");
    expect(issues).toEqual([{ path: "$", message: "Expected max length 3" }]);
  });

  it("validates numeric constraints (finite + integer)", () => {
    const schema = defineSchema({
      type: "number",
      finite: true,
      integer: true,
    });

    const nanIssues = validate(schema, Number.NaN);
    expect(nanIssues).toEqual([{ path: "$", message: "Expected number" }]);

    const infIssues = validate(schema, Number.POSITIVE_INFINITY);
    expect(infIssues).toEqual([
      { path: "$", message: "Expected finite number" },
      { path: "$", message: "Expected integer" },
    ]);

    const floatIssues = validate(schema, 1.5);
    expect(floatIssues).toEqual([{ path: "$", message: "Expected integer" }]);
  });
});
