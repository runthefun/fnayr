import { describe, expect, it } from "vitest";
import { parseWorld, serializeWorld, type ComponentRegistry } from "./world";
import { defineSchema } from "./schema";

const registry: ComponentRegistry = {
  Transform: defineSchema({
    type: "object",
    properties: {
      position: {
        type: "tuple",
        items: [{ type: "number" }, { type: "number" }],
      },
      scale: { type: "number" },
    },
  }),
  Name: defineSchema({
    type: "object",
    properties: {
      label: { type: "string" },
    },
  }),
};

describe("world parsing", () => {
  it("parses a valid world and preserves round-trip stability", () => {
    const worldJson = {
      version: 1,
      entities: [
        {
          id: 1,
          components: {
            Transform: { position: [1, 2], scale: 1 },
            Name: { label: "Hero" },
          },
        },
      ],
    };

    const parsed = parseWorld(registry, worldJson, { applyDefaults: false });
    expect(parsed.issues).toEqual([]);

    const encoded = serializeWorld(registry, parsed.world);
    expect(encoded.json).toEqual(worldJson);
    expect(encoded.issues).toEqual([]);
  });

  it("reports component validation errors with fully-qualified paths", () => {
    const worldJson = {
      version: 1,
      entities: [
        {
          id: 7,
          components: {
            Transform: { position: [1, "bad"] },
          },
        },
      ],
    };

    const parsed = parseWorld(registry, worldJson, { applyDefaults: false });

    expect(parsed.issues).toEqual([
      {
        path: "$.entities[0].components.Transform.position[1]",
        message: "Expected number",
      },
      {
        path: "$.entities[0].components.Transform.scale",
        message: "Missing required property",
      },
    ]);
  });

  it("flags unknown components unless explicitly allowed", () => {
    const worldJson = {
      version: 1,
      entities: [
        {
          id: 2,
          components: {
            Unknown: { foo: "bar" },
          },
        },
      ],
    };

    const strict = parseWorld(registry, worldJson);
    expect(strict.issues).toEqual([
      {
        path: "$.entities[0].components.Unknown",
        message: "Unknown component",
      },
    ]);

    const permissive = parseWorld(registry, worldJson, {
      allowUnknownComponents: true,
    });
    expect(permissive.issues).toEqual([]);
    expect(permissive.world.entities[0].unknownComponents).toEqual({
      Unknown: { foo: "bar" },
    });
  });

  it("reports world/entity boundary errors with correct paths", () => {
    const worldJson = {
      entities: [{}],
    };

    const parsed = parseWorld(registry, worldJson, { applyDefaults: false });

    expect(parsed.issues).toEqual([
      { path: "$.version", message: "Missing required property" },
      { path: "$.entities[0].id", message: "Missing required property" },
      { path: "$.entities[0].components", message: "Missing required property" },
    ]);
  });
});
