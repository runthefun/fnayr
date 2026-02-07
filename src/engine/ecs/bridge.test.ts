import { describe, expect, it, vi } from "vitest";
import { s } from "../schema";
import { worldFromJson, worldToJson } from "./bridge";
import { EcsWorld } from "./world";

describe("worldFromJson/worldToJson", () => {
  const registry = {
    Transform: s.object({ x: s.number() }),
    Name: s.object({ label: s.string() }),
  };

  it("round-trips known components", () => {
    const json = {
      version: 1,
      entities: [
        {
          id: 1,
          components: {
            Transform: { x: 4 },
            Name: { label: "Hero" },
          },
        },
      ],
    };

    const parsed = worldFromJson(registry, json);
    expect(parsed.issues).toEqual([]);

    const serialized = worldToJson(registry, parsed.world);
    expect(serialized.issues).toEqual([]);
    expect(serialized.json).toEqual(json);
  });

  it("preserves unknown components when allowed", () => {
    const json = {
      version: 1,
      entities: [
        {
          id: 2,
          components: {
            Transform: { x: 1 },
            Custom: { foo: "bar" },
          },
        },
      ],
    };

    const parsed = worldFromJson(registry, json, { allowUnknownComponents: true });
    expect(parsed.issues).toEqual([]);

    const serialized = worldToJson(registry, parsed.world, {
      stripUnknownComponents: false,
    });

    expect(serialized.json.entities[0].components.Custom).toEqual({ foo: "bar" });
  });

  it("surfaces validation errors with paths", () => {
    const json = {
      version: 1,
      entities: [
        {
          id: 3,
          components: {
            Transform: { x: "oops" },
          },
        },
      ],
    };

    const parsed = worldFromJson(registry, json);

    expect(parsed.issues).toContainEqual({
      path: "$.entities[0].components.Transform.x",
      message: "Expected number",
    });
  });

  it("round-trips tag components", () => {
    const tagRegistry = {
      Transform: s.object({ x: s.number() }),
      Visible: s.tag(),
    };

    const json = {
      version: 1,
      entities: [
        {
          id: 1,
          components: {
            Transform: { x: 4 },
            Visible: true,
          },
        },
      ],
    };

    const parsed = worldFromJson(tagRegistry, json);
    expect(parsed.issues).toEqual([]);
    expect(parsed.world.hasComponent(1, "Visible")).toBe(true);
    expect(parsed.world.getComponent(1, "Visible")).toBe(true);

    const serialized = worldToJson(tagRegistry, parsed.world);
    expect(serialized.issues).toEqual([]);
    expect(serialized.json).toEqual(json);
  });

  it("registers cleanup for hydrated unknown components", () => {
    const listenerSpy = vi.spyOn(EcsWorld.prototype, "onEntityDestroyed");
    const json = {
      version: 1,
      entities: [
        {
          id: 2,
          components: {
            Transform: { x: 1 },
            Custom: { foo: "bar" },
          },
        },
      ],
    };

    worldFromJson(registry, json, { allowUnknownComponents: true });

    expect(listenerSpy).toHaveBeenCalledTimes(1);
    listenerSpy.mockRestore();
  });
});

describe("hierarchy serialization", () => {
  const registry = {
    Name: s.object({ label: s.string() }),
  };

  it("round-trips hierarchy through worldFromJson and worldToJson", () => {
    const json = {
      version: 1,
      entities: [
        { id: 1, components: { Name: { label: "Root" } } },
        { id: 2, components: { Name: { label: "Child" } }, parent: 1 },
        { id: 3, components: { Name: { label: "Grandchild" } }, parent: 2 },
      ],
    };

    const parsed = worldFromJson(registry, json, { hierarchy: true });
    expect(parsed.issues).toEqual([]);
    expect(parsed.hierarchy).toBeDefined();
    expect(parsed.hierarchy!.getParent(2)).toBe(1);
    expect(parsed.hierarchy!.getParent(3)).toBe(2);
    expect(parsed.hierarchy!.getChildren(1)).toEqual([2]);
    expect(parsed.hierarchy!.getChildren(2)).toEqual([3]);

    const serialized = worldToJson(registry, parsed.world, {
      hierarchy: parsed.hierarchy!,
    });
    expect(serialized.issues).toEqual([]);
    expect(serialized.json).toEqual(json);
  });

  it("reports missing parent entity", () => {
    const json = {
      version: 1,
      entities: [
        { id: 1, components: { Name: { label: "Child" } }, parent: 99 },
      ],
    };

    const parsed = worldFromJson(registry, json, { hierarchy: true });
    expect(parsed.issues).toContainEqual({
      path: "$.entities[0].parent",
      message: "Parent entity 99 does not exist",
    });
  });

  it("does not create hierarchy when option is false", () => {
    const json = {
      version: 1,
      entities: [
        { id: 1, components: { Name: { label: "Root" } } },
        { id: 2, components: { Name: { label: "Child" } }, parent: 1 },
      ],
    };

    const parsed = worldFromJson(registry, json);
    expect(parsed.hierarchy).toBeUndefined();
  });

  it("omits parent from output when no hierarchy option provided", () => {
    const json = {
      version: 1,
      entities: [
        { id: 1, components: { Name: { label: "Root" } } },
      ],
    };

    const parsed = worldFromJson(registry, json);
    const serialized = worldToJson(registry, parsed.world);
    expect(serialized.json.entities[0]).not.toHaveProperty("parent");
  });
});

describe("resource serialization", () => {
  const registry = {
    Name: s.object({ label: s.string() }),
  };

  const resourceRegistry = {
    Score: s.object({ value: s.number() }),
    Level: s.object({ name: s.string() }),
  };

  it("round-trips resources through worldFromJson and worldToJson", () => {
    const json = {
      version: 1,
      entities: [
        { id: 1, components: { Name: { label: "Hero" } } },
      ],
      resources: {
        Score: { value: 42 },
        Level: { name: "Forest" },
      },
    };

    const parsed = worldFromJson(registry, json, { resources: resourceRegistry });
    expect(parsed.issues).toEqual([]);
    expect((parsed.world as any).getResource("Score")).toEqual({ value: 42 });
    expect((parsed.world as any).getResource("Level")).toEqual({ name: "Forest" });

    const serialized = worldToJson(registry, parsed.world);
    expect(serialized.issues).toEqual([]);
    expect(serialized.json).toEqual(json);
  });

  it("omits resources from output when none are set", () => {
    const json = {
      version: 1,
      entities: [
        { id: 1, components: { Name: { label: "Hero" } } },
      ],
    };

    const parsed = worldFromJson(registry, json, { resources: resourceRegistry });
    expect(parsed.issues).toEqual([]);

    const serialized = worldToJson(registry, parsed.world);
    expect(serialized.json).not.toHaveProperty("resources");
  });
});

describe("combined hierarchy and resources", () => {
  const registry = {
    Name: s.object({ label: s.string() }),
  };

  const resourceRegistry = {
    Score: s.object({ value: s.number() }),
  };

  it("round-trips both hierarchy and resources together", () => {
    const json = {
      version: 1,
      entities: [
        { id: 1, components: { Name: { label: "Root" } } },
        { id: 2, components: { Name: { label: "Child" } }, parent: 1 },
      ],
      resources: {
        Score: { value: 100 },
      },
    };

    const parsed = worldFromJson(registry, json, {
      hierarchy: true,
      resources: resourceRegistry,
    });
    expect(parsed.issues).toEqual([]);
    expect(parsed.hierarchy).toBeDefined();
    expect(parsed.hierarchy!.getParent(2)).toBe(1);
    expect((parsed.world as any).getResource("Score")).toEqual({ value: 100 });

    const serialized = worldToJson(registry, parsed.world, {
      hierarchy: parsed.hierarchy!,
    });
    expect(serialized.issues).toEqual([]);
    expect(serialized.json).toEqual(json);
  });
});
