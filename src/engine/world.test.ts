import { describe, expect, it } from "vitest";
import { parseWorld, serializeWorld, type ComponentRegistry } from "./world";
import { defineSchema, s } from "./schema";

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

describe("parent field", () => {
  it("round-trips entities with parent fields", () => {
    const worldJson = {
      version: 1,
      entities: [
        { id: 1, components: { Name: { label: "Root" } } },
        { id: 2, components: { Name: { label: "Child" } }, parent: 1 },
      ],
    };

    const parsed = parseWorld(registry, worldJson, { applyDefaults: false });
    expect(parsed.issues).toEqual([]);
    expect(parsed.world.entities[1].parent).toBe(1);

    const encoded = serializeWorld(registry, parsed.world);
    expect(encoded.issues).toEqual([]);
    expect(encoded.json).toEqual(worldJson);
  });

  it("reports invalid parent (non-number)", () => {
    const worldJson = {
      version: 1,
      entities: [
        { id: 1, components: {}, parent: "bad" },
      ],
    };

    const parsed = parseWorld(registry, worldJson, { applyDefaults: false });
    expect(parsed.issues).toContainEqual({
      path: "$.entities[0].parent",
      message: "Expected number",
    });
    expect(parsed.world.entities[0].parent).toBeUndefined();
  });

  it("reports invalid parent (non-integer)", () => {
    const worldJson = {
      version: 1,
      entities: [
        { id: 1, components: {}, parent: 1.5 },
      ],
    };

    const parsed = parseWorld(registry, worldJson, { applyDefaults: false });
    expect(parsed.issues).toContainEqual({
      path: "$.entities[0].parent",
      message: "Expected integer",
    });
    expect(parsed.world.entities[0].parent).toBeUndefined();
  });

  it("omits parent from output when not present", () => {
    const worldJson = {
      version: 1,
      entities: [
        { id: 1, components: { Name: { label: "Solo" } } },
      ],
    };

    const parsed = parseWorld(registry, worldJson, { applyDefaults: false });
    const encoded = serializeWorld(registry, parsed.world);
    expect(encoded.json.entities[0]).not.toHaveProperty("parent");
  });
});

describe("resources", () => {
  const resourceRegistry = {
    Score: s.object({ value: s.number() }),
    Level: s.object({ name: s.string() }),
  };

  it("round-trips resources through parse and serialize", () => {
    const worldJson = {
      version: 1,
      entities: [],
      resources: {
        Score: { value: 42 },
        Level: { name: "Forest" },
      },
    };

    const parsed = parseWorld(registry, worldJson, {
      applyDefaults: false,
      resourceRegistry,
    });
    expect(parsed.issues).toEqual([]);
    expect(parsed.world.resources).toEqual({
      Score: { value: 42 },
      Level: { name: "Forest" },
    });

    const encoded = serializeWorld(registry, parsed.world, { resourceRegistry });
    expect(encoded.issues).toEqual([]);
    expect(encoded.json).toEqual(worldJson);
  });

  it("flags unknown resources by default", () => {
    const worldJson = {
      version: 1,
      entities: [],
      resources: {
        Unknown: { foo: "bar" },
      },
    };

    const parsed = parseWorld(registry, worldJson, { resourceRegistry });
    expect(parsed.issues).toContainEqual({
      path: "$.resources.Unknown",
      message: "Unknown resource",
    });
  });

  it("allows unknown resources when opted in", () => {
    const worldJson = {
      version: 1,
      entities: [],
      resources: {
        Unknown: { foo: "bar" },
      },
    };

    const parsed = parseWorld(registry, worldJson, {
      resourceRegistry,
      allowUnknownResources: true,
    });
    expect(parsed.issues).toEqual([]);
  });

  it("reports unknown resources when no resource registry is provided", () => {
    const worldJson = {
      version: 1,
      entities: [],
      resources: {
        Score: { value: 42 },
      },
    };

    const parsed = parseWorld(registry, worldJson);
    expect(parsed.issues).toContainEqual({
      path: "$.resources.Score",
      message: "Unknown resource",
    });
  });

  it("omits resources from output when not present", () => {
    const worldJson = {
      version: 1,
      entities: [],
    };

    const parsed = parseWorld(registry, worldJson);
    const encoded = serializeWorld(registry, parsed.world, { resourceRegistry });
    expect(encoded.json).not.toHaveProperty("resources");
  });

  it("backward compat: existing JSON without parent/resources parses cleanly", () => {
    const worldJson = {
      version: 1,
      entities: [
        {
          id: 1,
          components: {
            Transform: { position: [1, 2], scale: 1 },
          },
        },
      ],
    };

    const parsed = parseWorld(registry, worldJson, { applyDefaults: false });
    expect(parsed.issues).toEqual([]);
    expect(parsed.world.entities[0].parent).toBeUndefined();
    expect(parsed.world.resources).toBeUndefined();
  });
});
