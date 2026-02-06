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
