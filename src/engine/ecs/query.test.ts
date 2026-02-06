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

  it("does not skip entities when one is destroyed during iteration", () => {
    const world = createWorld(registry);
    const a = world.createEntity();
    const b = world.createEntity();
    const c = world.createEntity();

    world.addComponent(a, "Transform", { x: 1 });
    world.addComponent(b, "Transform", { x: 2 });
    world.addComponent(c, "Transform", { x: 3 });

    const visited: number[] = [];
    for (const row of world.query(["Transform"])) {
      visited.push(row.entity);
      if (row.entity === a) {
        world.destroyEntity(a);
      }
    }

    expect(visited.sort()).toEqual([a, b, c].sort());
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

describe("EcsWorld createQuery (cached query)", () => {
  const registry = {
    Transform: s.object({ x: s.number() }),
    Name: s.object({ label: s.string() }),
    Hidden: s.object({ value: s.boolean() }),
  };

  it("returns same results as on-demand query", () => {
    const world = createWorld(registry);
    const a = world.createEntity();
    const b = world.createEntity();
    const c = world.createEntity();

    world.addComponent(a, "Transform", { x: 1 });
    world.addComponent(b, "Transform", { x: 2 });
    world.addComponent(b, "Name", { label: "Hero" });
    world.addComponent(c, "Name", { label: "OnlyName" });

    const cached = world.createQuery(["Transform"]);
    const onDemand = world.query(["Transform"]);

    const cachedEntities = Array.from(cached).map((r) => r.entity).sort();
    const onDemandEntities = Array.from(onDemand).map((r) => r.entity).sort();

    expect(cachedEntities).toEqual(onDemandEntities);
    expect(cached.size).toBe(2);
  });

  it("updates when components are added", () => {
    const world = createWorld(registry);
    const a = world.createEntity();

    const cached = world.createQuery(["Transform"]);
    expect(cached.size).toBe(0);

    world.addComponent(a, "Transform", { x: 1 });
    expect(cached.size).toBe(1);

    const results = Array.from(cached);
    expect(results).toHaveLength(1);
    expect(results[0].entity).toBe(a);
    expect(results[0].components.Transform.x).toBe(1);
  });

  it("updates when components are removed", () => {
    const world = createWorld(registry);
    const a = world.createEntity();
    world.addComponent(a, "Transform", { x: 1 });

    const cached = world.createQuery(["Transform"]);
    expect(cached.size).toBe(1);

    world.removeComponent(a, "Transform");
    expect(cached.size).toBe(0);
    expect(Array.from(cached)).toEqual([]);
  });

  it("updates when entities are destroyed", () => {
    const world = createWorld(registry);
    const a = world.createEntity();
    const b = world.createEntity();
    world.addComponent(a, "Transform", { x: 1 });
    world.addComponent(b, "Transform", { x: 2 });

    const cached = world.createQuery(["Transform"]);
    expect(cached.size).toBe(2);

    world.destroyEntity(a);
    expect(cached.size).toBe(1);

    const results = Array.from(cached);
    expect(results).toHaveLength(1);
    expect(results[0].entity).toBe(b);
  });

  it("respects exclude filters", () => {
    const world = createWorld(registry);
    const visible = world.createEntity();
    const hidden = world.createEntity();

    world.addComponent(visible, "Transform", { x: 10 });
    world.addComponent(hidden, "Transform", { x: 20 });

    const cached = world.createQuery(["Transform"], { exclude: ["Hidden"] });
    expect(cached.size).toBe(2);

    // Adding excluded component removes entity from cached query
    world.addComponent(hidden, "Hidden", { value: true });
    expect(cached.size).toBe(1);

    const results = Array.from(cached);
    expect(results).toHaveLength(1);
    expect(results[0].entity).toBe(visible);

    // Removing excluded component adds entity back
    world.removeComponent(hidden, "Hidden");
    expect(cached.size).toBe(2);
  });

  it("handles multi-component include correctly", () => {
    const world = createWorld(registry);
    const a = world.createEntity();
    const b = world.createEntity();

    world.addComponent(a, "Transform", { x: 1 });

    const cached = world.createQuery(["Transform", "Name"]);
    expect(cached.size).toBe(0);

    // Adding one component is not enough
    world.addComponent(b, "Transform", { x: 2 });
    expect(cached.size).toBe(0);

    // Adding second component makes it match
    world.addComponent(b, "Name", { label: "Hero" });
    expect(cached.size).toBe(1);

    // Entity a also gains Name
    world.addComponent(a, "Name", { label: "Other" });
    expect(cached.size).toBe(2);

    // Removing one required component removes from match
    world.removeComponent(a, "Transform");
    expect(cached.size).toBe(1);
  });

  it("provides correct component data when iterated", () => {
    const world = createWorld(registry);
    const a = world.createEntity();
    world.addComponent(a, "Transform", { x: 42 });
    world.addComponent(a, "Name", { label: "Test" });

    const cached = world.createQuery(["Transform", "Name"]);
    const results = Array.from(cached);

    expect(results).toHaveLength(1);
    expect(results[0].components.Transform.x).toBe(42);
    expect(results[0].components.Name.label).toBe("Test");
  });

  it("works after world.clear()", () => {
    const world = createWorld(registry);
    const a = world.createEntity();
    world.addComponent(a, "Transform", { x: 1 });

    const cached = world.createQuery(["Transform"]);
    expect(cached.size).toBe(1);

    world.clear();
    expect(cached.size).toBe(0);

    // New entities are tracked after clear
    const b = world.createEntity();
    world.addComponent(b, "Transform", { x: 2 });
    expect(cached.size).toBe(1);
  });

  it("does not skip entities during iteration when one is destroyed", () => {
    const world = createWorld(registry);
    const a = world.createEntity();
    const b = world.createEntity();
    const c = world.createEntity();

    world.addComponent(a, "Transform", { x: 1 });
    world.addComponent(b, "Transform", { x: 2 });
    world.addComponent(c, "Transform", { x: 3 });

    const cached = world.createQuery(["Transform"]);

    const visited: number[] = [];
    for (const row of cached) {
      visited.push(row.entity);
      if (row.entity === a) {
        world.destroyEntity(a);
      }
    }

    expect(visited.sort()).toEqual([a, b, c].sort());
  });
});
