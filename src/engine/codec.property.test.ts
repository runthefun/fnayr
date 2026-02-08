import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { deserialize, serialize } from "./codec";
import { defineSchema } from "./schema";

const finiteNumberArb = fc.double({
  min: -1_000,
  max: 1_000,
  noNaN: true,
  noDefaultInfinity: true,
});

const vec3Arb = fc
  .tuple(finiteNumberArb, finiteNumberArb, finiteNumberArb)
  .map(([x, y, z]) => [x, y, z] as [number, number, number]);

const tagsArb = fc.array(fc.string({ maxLength: 8 }), { maxLength: 4 });
const weightsArb = fc.dictionary(
  fc.string({ minLength: 1, maxLength: 6 }),
  fc.integer({ min: -8, max: 8 }),
  { maxKeys: 4 },
);

const childArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 10 }),
  mass: finiteNumberArb,
});

const transformSchema = defineSchema({
  type: "object",
  properties: {
    id: { type: "string" },
    visible: { type: "boolean" },
    layer: { type: "enum", values: ["default", "fx", "ui"] as const },
    position: {
      type: "tuple",
      items: [{ type: "number" }, { type: "number" }, { type: "number" }],
    },
    tags: { type: "array", items: { type: "string" }, maxItems: 4 },
    weights: { type: "map", values: { type: "number", integer: true } },
    children: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          mass: { type: "number" },
        },
      },
      maxItems: 3,
    },
    note: { type: "optional", inner: { type: "string" } },
  },
});

const transformValueArb = fc.oneof(
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 12 }),
    visible: fc.boolean(),
    layer: fc.constantFrom("default", "fx", "ui"),
    position: vec3Arb,
    tags: tagsArb,
    weights: weightsArb,
    children: fc.array(childArb, { maxLength: 3 }),
  }),
  fc.record({
    id: fc.string({ minLength: 1, maxLength: 12 }),
    visible: fc.boolean(),
    layer: fc.constantFrom("default", "fx", "ui"),
    position: vec3Arb,
    tags: tagsArb,
    weights: weightsArb,
    children: fc.array(childArb, { maxLength: 3 }),
    note: fc.string({ maxLength: 24 }),
  }),
);

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
    capsule: {
      type: "object",
      properties: {
        kind: { type: "literal", value: "capsule" },
        radius: { type: "number", min: 0 },
        height: { type: "number", min: 0 },
      },
    },
  },
});

const colliderValueArb = fc.oneof(
  vec3Arb.map((size) => ({ kind: "box" as const, size })),
  finiteNumberArb
    .filter((radius) => radius >= 0)
    .map((radius) => ({ kind: "sphere" as const, radius })),
  fc
    .tuple(finiteNumberArb, finiteNumberArb)
    .filter(([radius, height]) => radius >= 0 && height >= 0)
    .map(([radius, height]) => ({ kind: "capsule" as const, radius, height })),
);

const optionalStringSchema = defineSchema({
  type: "optional",
  inner: { type: "string" },
});

const optionalStringValueArb = fc.option(fc.string({ maxLength: 40 }), {
  nil: undefined,
});

const unknownKeySchema = defineSchema({
  type: "object",
  properties: {
    name: { type: "string" },
  },
});

const unknownKeyInputArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 12 }),
  extras: fc.dictionary(fc.string({ minLength: 1, maxLength: 10 }), fc.jsonValue(), {
    maxKeys: 6,
  }),
});

function assertCanonicalRoundTrip(schema: unknown, value: unknown): void {
  const encoded1 = serialize(schema as any, value as any, {
    validation: { allowUnknownProperties: false },
  });
  expect(encoded1.issues).toEqual([]);

  const decoded1 = deserialize(schema as any, encoded1.json, {
    applyDefaults: false,
    validation: { allowUnknownProperties: false },
  });
  expect(decoded1.issues).toEqual([]);
  expect(decoded1.value).toEqual(value);

  const encoded2 = serialize(schema as any, decoded1.value as any, {
    validation: { allowUnknownProperties: false },
  });
  expect(encoded2.issues).toEqual([]);
  expect(encoded2.json).toEqual(encoded1.json);
}

describe("codec (property-based)", () => {
  it("round-trips schema-valid object values", () => {
    fc.assert(
      fc.property(transformValueArb, (value) => {
        assertCanonicalRoundTrip(transformSchema, value);
      }),
      { numRuns: 300 },
    );
  });

  it("round-trips schema-valid tagged-union values", () => {
    fc.assert(
      fc.property(colliderValueArb, (value) => {
        assertCanonicalRoundTrip(colliderSchema, value);
      }),
      { numRuns: 300 },
    );
  });

  it("round-trips top-level optional values", () => {
    fc.assert(
      fc.property(optionalStringValueArb, (value) => {
        assertCanonicalRoundTrip(optionalStringSchema, value);
      }),
      { numRuns: 300 },
    );
  });

  it("stripUnknown removes unknown properties while preserving known fields", () => {
    fc.assert(
      fc.property(unknownKeyInputArb, ({ name, extras }) => {
        const safeExtras: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(extras)) {
          if (key !== "name") safeExtras[key] = entry;
        }

        const input = { name, ...safeExtras };
        const unknownCount = Object.keys(safeExtras).length;

        const unstripped = serialize(unknownKeySchema, input);
        expect(unstripped.json).toEqual(input);
        expect(unstripped.issues.length).toBe(unknownCount);

        const stripped = serialize(unknownKeySchema, input, { stripUnknown: true });
        expect(stripped.json).toEqual({ name });
        expect(stripped.issues.length).toBe(unknownCount);

        const decoded = deserialize(unknownKeySchema, stripped.json, { applyDefaults: false });
        expect(decoded.issues).toEqual([]);
        expect(decoded.value).toEqual({ name });
      }),
      { numRuns: 250 },
    );
  });
});
