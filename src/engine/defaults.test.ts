import { describe, expect, it } from "vitest";
import { defineSchema, getDefault } from "./schema";

describe("getDefault", () => {
  it("materializes scalar defaults and overrides", () => {
    const stringSchema = defineSchema({ type: "string" });
    const stringDefault = defineSchema({ type: "string", default: "hello" });
    const numberSchema = defineSchema({ type: "number" });
    const numberDefault = defineSchema({ type: "number", default: 7 });
    const booleanSchema = defineSchema({ type: "boolean" });
    const booleanDefault = defineSchema({ type: "boolean", default: true });
    const enumSchema = defineSchema({
      type: "enum",
      values: ["idle", "run"] as const,
    });
    const enumDefault = defineSchema({
      type: "enum",
      values: ["idle", "run"] as const,
      default: "run",
    });
    const literalSchema = defineSchema({ type: "literal", value: "hero" });

    expect(getDefault(stringSchema)).toBe("");
    expect(getDefault(stringDefault)).toBe("hello");
    expect(getDefault(numberSchema)).toBe(0);
    expect(getDefault(numberDefault)).toBe(7);
    expect(getDefault(booleanSchema)).toBe(false);
    expect(getDefault(booleanDefault)).toBe(true);
    expect(getDefault(enumSchema)).toBe("idle");
    expect(getDefault(enumDefault)).toBe("run");
    expect(getDefault(literalSchema)).toBe("hero");
  });

  it("skips optional fields and composes object defaults", () => {
    const schema = defineSchema({
      type: "object",
      properties: {
        name: { type: "string" },
        active: { type: "boolean", default: true },
        note: { type: "optional", inner: { type: "string", default: "n/a" } },
        position: {
          type: "tuple",
          items: [{ type: "number" }, { type: "number" }],
        },
      },
    });

    const defaults = getDefault(schema);

    expect(defaults).toEqual({
      name: "",
      active: true,
      position: [0, 0],
    });
    expect("note" in defaults).toBe(false);
  });

  it("materializes defaults for arrays, tuples, maps, and optional", () => {
    const arraySchema = defineSchema({ type: "array", items: { type: "number" } });
    const tupleSchema = defineSchema({
      type: "tuple",
      items: [{ type: "string" }, { type: "boolean" }],
    });
    const mapSchema = defineSchema({ type: "map", values: { type: "string" } });
    const optionalSchema = defineSchema({
      type: "optional",
      inner: { type: "number", default: 3 },
    });

    expect(getDefault(arraySchema)).toEqual([]);
    expect(getDefault(tupleSchema)).toEqual(["", false]);
    expect(getDefault(mapSchema)).toEqual({});
    expect(getDefault(optionalSchema)).toBeUndefined();
  });

  it("uses tagged-union defaults with fallback to the first variant", () => {
    const colliderSchema = defineSchema({
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
    const explicitDefaultSchema = defineSchema({
      type: "taggedUnion",
      tag: "kind",
      variants: colliderSchema.variants,
      default: { kind: "sphere", radius: 2 },
    });

    expect(getDefault(colliderSchema)).toEqual({
      kind: "box",
      size: [0, 0, 0],
    });
    expect(getDefault(explicitDefaultSchema)).toEqual({
      kind: "sphere",
      radius: 2,
    });
  });
});
