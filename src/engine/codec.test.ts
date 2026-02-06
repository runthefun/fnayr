import { describe, expect, it } from "vitest";
import { deserialize, serialize } from "./codec";
import { defineSchema } from "./schema";

describe("serialize", () => {
  it("omits optional undefined fields and reports unknown keys by default", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        note: { type: "optional", inner: { type: "string" } },
      },
    });

    const result = serialize(schema, {
      name: "hero",
      note: undefined,
      extra: 42,
    });

    expect(result.json).toEqual({ name: "hero", extra: 42 });
    expect(result.issues).toEqual([
      { path: "$.extra", message: "Unknown property" },
    ]);
  });

  it("can allow unknown keys via validation options", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        name: { type: "string" },
      },
    });

    const result = serialize(
      schema,
      { name: "hero", extra: 123 },
      { validation: { allowUnknownProperties: true } }
    );

    expect(result.json).toEqual({ name: "hero", extra: 123 });
    expect(result.issues).toEqual([]);
  });

  it("can strip unknown keys when requested", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        name: { type: "string" },
      },
    });

    const result = serialize(
      schema,
      { name: "hero", extra: 123 },
      { stripUnknown: true }
    );

    expect(result.json).toEqual({ name: "hero" });
  });

  it("returns validation issues when the input is invalid", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        name: { type: "string" },
      },
    });

    const result = serialize(schema, { name: 123 });

    expect(result.issues).toEqual([
      { path: "$.name", message: "Expected string" },
    ]);
  });

  it("returns undefined for top-level optional values", () => {
    const schema = defineSchema({
      type: "optional",
      inner: { type: "string" },
    });

    const result = serialize(schema, undefined);

    expect(result.json).toBeUndefined();
    expect(result.issues).toEqual([]);
  });
});

describe("deserialize", () => {
  it("applies defaults by default", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        scale: { type: "number", default: 2 },
      },
    });

    const result = deserialize(schema, { name: "hero" });

    expect(result.value).toEqual({ name: "hero", scale: 2 });
    expect(result.issues).toEqual([]);
  });

  it("can skip defaults when requested", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        scale: { type: "number", default: 2 },
      },
    });

    const result = deserialize(schema, { name: "hero" }, { applyDefaults: false });

    expect(result.value).toEqual({ name: "hero" });
    expect(result.issues).toEqual([
      { path: "$.scale", message: "Missing required property" },
    ]);
  });
});
