import { describe, expect, it } from "vitest";
import { s } from "../schema";
import { createWorld } from "./world";

describe("EcsWorld query", () => {
  const registry = {
    Transform: s.object({ x: s.number() }),
    Name: s.object({ label: s.string() }),
    Hidden: s.object({ value: s.boolean() }),
  };

  it("returns entities that include required components", () => {
    const world = createWorld(registry);
    const a = world.createEntity();
    const b = world.createEntity();
    const c = world.createEntity();

    world.addComponent(a, "Transform", { x: 1 });
    world.addComponent(b, "Transform", { x: 2 });
    world.addComponent(b, "Name", { label: "Hero" });
    world.addComponent(c, "Name", { label: "OnlyName" });

    const results = Array.from(world.query(["Transform"]));

    expect(results.map((row) => row.entity).sort()).toEqual([a, b].sort());
    expect(results.map((row) => row.components.Transform.x).sort()).toEqual([1, 2]);

    const namedTransforms = Array.from(world.query(["Transform", "Name"]));
    expect(namedTransforms).toHaveLength(1);
    expect(namedTransforms[0].entity).toBe(b);
    expect(namedTransforms[0].components.Name.label).toBe("Hero");
  });

  it("supports exclude filters", () => {
    const world = createWorld(registry);
    const visible = world.createEntity();
    const hidden = world.createEntity();

    world.addComponent(visible, "Transform", { x: 10 });
    world.addComponent(hidden, "Transform", { x: 20 });
    world.addComponent(hidden, "Hidden", { value: true });

    const results = Array.from(
      world.query(["Transform"], { exclude: ["Hidden"] })
    );

    expect(results).toHaveLength(1);
    expect(results[0].entity).toBe(visible);
  });

  it("reflects entity lifecycle changes across iterations", () => {
    const world = createWorld(registry);
    const query = world.query(["Transform"]);

    const first = world.createEntity();
    world.addComponent(first, "Transform", { x: 5 });

    expect(Array.from(query).map((row) => row.entity)).toEqual([first]);

    world.destroyEntity(first);
    const second = world.createEntity();
    world.addComponent(second, "Transform", { x: 9 });

    expect(Array.from(query).map((row) => row.entity)).toEqual([second]);
  });
});
