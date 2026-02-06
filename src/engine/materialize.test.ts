import { describe, expect, it } from "vitest";
import { applyDefaults, materialize } from "./materialize";
import { defineSchema } from "./schema";

describe("materialize", () => {
  it("applies defaults before validation", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        scale: { type: "number", default: 2 },
        note: { type: "optional", inner: { type: "string" } },
        nested: {
          type: "object",
          properties: {
            active: { type: "boolean" },
          },
        },
      },
    });

    const result = materialize(schema, { name: "hero", nested: {} });
    expect(result.value).toEqual({
      name: "hero",
      scale: 2,
      nested: { active: false },
    });
    expect(result.issues).toEqual([]);
  });

  it("keeps required fields missing and validates explicit values", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        scale: { type: "number", default: 2, required: true },
        label: { type: "string", required: true },
      },
    });

    const missing = materialize(schema, {});
    expect(missing.value).toEqual({});
    expect(missing.issues).toEqual([
      { path: "$.scale", message: "Missing required property" },
      { path: "$.label", message: "Missing required property" },
    ]);

    const invalid = materialize(schema, { scale: "bad", label: "ok" });
    expect(invalid.value).toEqual({ scale: "bad", label: "ok" });
    expect(invalid.issues).toEqual([
      { path: "$.scale", message: "Expected number" },
    ]);
  });
});

describe("applyDefaults", () => {
  it("keeps unknown properties while filling known defaults", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        kind: { type: "literal", value: "box" },
        size: { type: "number" },
      },
    });

    expect(applyDefaults(schema, { kind: "box", extra: 123 })).toEqual({
      kind: "box",
      size: 0,
      extra: 123,
    });
  });

  it("keeps invalid tagged-union input to surface validation", () => {
    const schema = defineSchema({
      type: "taggedUnion",
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

    expect(applyDefaults(schema, { kind: "capsule" })).toEqual({
      kind: "capsule",
    });
  });

  it("falls back to the first tagged-union variant when missing", () => {
    const schema = defineSchema({
      type: "taggedUnion",
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

    expect(applyDefaults(schema, undefined)).toEqual({
      kind: "box",
      size: [0, 0, 0],
    });
  });
});
