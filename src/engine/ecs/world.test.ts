import { describe, expect, it } from "vitest";
import { s } from "../schema";
import { createWorld } from "./world";

describe("EcsWorld", () => {
  const registry = {
    Transform: s.object({ x: s.number() }),
    Name: s.object({ label: s.string() }),
  };

  it("adds, gets, checks, and removes components", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    expect(world.hasComponent(entity, "Transform")).toBe(false);

    world.addComponent(entity, "Transform", { x: 2 });

    expect(world.hasComponent(entity, "Transform")).toBe(true);
    expect(world.getComponent(entity, "Transform")).toEqual({ x: 2 });

    world.removeComponent(entity, "Transform");

    expect(world.hasComponent(entity, "Transform")).toBe(false);
    expect(world.getComponent(entity, "Transform")).toBeUndefined();
  });

  it("cleans up components when entities are destroyed", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 1 });
    world.addComponent(entity, "Name", { label: "Hero" });

    world.destroyEntity(entity);

    expect(world.isAlive(entity)).toBe(false);
    expect(world.hasComponent(entity, "Transform")).toBe(false);
    expect(world.hasComponent(entity, "Name")).toBe(false);
  });

  it("rejects adding components to dead entities", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    world.destroyEntity(entity);

    expect(() =>
      world.addComponent(entity, "Transform", { x: 5 })
    ).toThrow(/not alive/i);
  });

  it("treats dead entities as empty for reads", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 3 });
    world.destroyEntity(entity);

    expect(world.getComponent(entity, "Transform")).toBeUndefined();
    expect(world.hasComponent(entity, "Transform")).toBe(false);
    expect(() => world.removeComponent(entity, "Transform")).not.toThrow();
  });

  it("notifies destroy listeners once and supports unsubscribe", () => {
    const world = createWorld(registry);
    const first = world.createEntity();
    const destroyed: number[] = [];
    const unsubscribe = world.onEntityDestroyed((entity) => destroyed.push(entity));

    world.destroyEntity(first);
    world.destroyEntity(first);
    expect(destroyed).toEqual([first]);

    unsubscribe();
    const second = world.createEntity();
    world.destroyEntity(second);
    expect(destroyed).toEqual([first]);
  });

  it("destroy listeners can access components on the entity being destroyed", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 42 });
    world.addComponent(entity, "Name", { label: "Hero" });

    let observedAlive = false;
    let observedTransform: { x: number } | undefined;
    let observedHasTransform = false;
    let observedHasName = false;

    world.onEntityDestroyed((e) => {
      observedAlive = world.isAlive(e);
      observedTransform = world.getComponent(e, "Transform");
      observedHasTransform = world.hasComponent(e, "Transform");
      observedHasName = world.hasComponent(e, "Name");
    });

    world.destroyEntity(entity);

    expect(observedAlive).toBe(true);
    expect(observedTransform).toEqual({ x: 42 });
    expect(observedHasTransform).toBe(true);
    expect(observedHasName).toBe(true);

    // After destruction, entity is dead and components are gone
    expect(world.isAlive(entity)).toBe(false);
    expect(world.hasComponent(entity, "Transform")).toBe(false);
    expect(world.getComponent(entity, "Transform")).toBeUndefined();
  });

  it("getMut returns the same reference as getComponent", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 5 });
    world.beginFrame();

    const ref = world.getComponent(entity, "Transform");
    const mutRef = world.getMut(entity, "Transform");
    expect(mutRef).toBe(ref);
  });

  it("mutating the getMut reference is visible via getComponent", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 1 });
    world.beginFrame();

    const mutRef = world.getMut(entity, "Transform");
    mutRef!.x = 99;

    expect(world.getComponent(entity, "Transform")).toEqual({ x: 99 });
  });

  it("getMut marks the component as updated in change tracking", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 1 });
    world.beginFrame();

    world.getMut(entity, "Transform");

    expect(world.getUpdated("Transform")).toContain(entity);
  });

  it("getMut on a same-frame-added component does not double-record as updated", () => {
    const world = createWorld(registry);
    world.beginFrame();
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 1 });

    world.getMut(entity, "Transform");

    expect(world.getAdded("Transform")).toContain(entity);
    expect(world.getUpdated("Transform")).not.toContain(entity);
  });

  it("getMut returns undefined for dead entities and missing components", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 1 });

    // Missing component
    expect(world.getMut(entity, "Name")).toBeUndefined();

    // Dead entity
    world.destroyEntity(entity);
    expect(world.getMut(entity, "Transform")).toBeUndefined();
  });

  it("change tracking still records removals for destroyed entity components", () => {
    const world = createWorld(registry);
    world.beginFrame();

    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 1 });
    world.addComponent(entity, "Name", { label: "Test" });

    // Flush the adds so they don't interfere
    world.beginFrame();

    world.destroyEntity(entity);

    expect(world.getRemoved("Transform")).toContain(entity);
    expect(world.getRemoved("Name")).toContain(entity);
  });
});

describe("Tag components", () => {
  const tagRegistry = {
    Transform: s.object({ x: s.number() }),
    Visible: s.tag(),
    Static: s.tag(),
  };

  it("addComponent without data arg works for tag components", () => {
    const world = createWorld(tagRegistry);
    const entity = world.createEntity();

    world.addComponent(entity, "Visible");

    expect(world.hasComponent(entity, "Visible")).toBe(true);
    expect(world.getComponent(entity, "Visible")).toBe(true);
  });

  it("addComponent with explicit data for tag stores true regardless", () => {
    const world = createWorld(tagRegistry);
    const entity = world.createEntity();

    // Even if data is passed, tag always stores true
    world.addComponent(entity, "Visible");

    expect(world.getComponent(entity, "Visible")).toBe(true);
  });

  it("hasComponent returns true for tag components", () => {
    const world = createWorld(tagRegistry);
    const entity = world.createEntity();

    world.addComponent(entity, "Visible");

    expect(world.hasComponent(entity, "Visible")).toBe(true);
  });

  it("tag components can be removed", () => {
    const world = createWorld(tagRegistry);
    const entity = world.createEntity();
    world.addComponent(entity, "Visible");

    world.removeComponent(entity, "Visible");

    expect(world.hasComponent(entity, "Visible")).toBe(false);
    expect(world.getComponent(entity, "Visible")).toBeUndefined();
  });

  it("tag components participate in queries (include)", () => {
    const world = createWorld(tagRegistry);
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    const e3 = world.createEntity();

    world.addComponent(e1, "Transform", { x: 1 });
    world.addComponent(e1, "Visible");

    world.addComponent(e2, "Transform", { x: 2 });

    world.addComponent(e3, "Transform", { x: 3 });
    world.addComponent(e3, "Visible");

    const results = [...world.query(["Transform", "Visible"] as const)];
    const entities = results.map((r) => r.entity);

    expect(entities).toContain(e1);
    expect(entities).not.toContain(e2);
    expect(entities).toContain(e3);

    // Verify tag data is available in query results
    for (const r of results) {
      expect(r.components.Visible).toBe(true);
    }
  });

  it("tag components participate in queries (exclude)", () => {
    const world = createWorld(tagRegistry);
    const e1 = world.createEntity();
    const e2 = world.createEntity();

    world.addComponent(e1, "Transform", { x: 1 });
    world.addComponent(e1, "Static");

    world.addComponent(e2, "Transform", { x: 2 });

    const results = [
      ...world.query(["Transform"] as const, { exclude: ["Static"] }),
    ];
    const entities = results.map((r) => r.entity);

    expect(entities).not.toContain(e1);
    expect(entities).toContain(e2);
  });

  it("tag components are tracked in change tracking", () => {
    const world = createWorld(tagRegistry);
    world.beginFrame();

    const entity = world.createEntity();
    world.addComponent(entity, "Visible");

    expect(world.getAdded("Visible")).toContain(entity);

    world.beginFrame();
    world.removeComponent(entity, "Visible");

    expect(world.getRemoved("Visible")).toContain(entity);
  });

  it("addComponent without data for non-tag component uses schema defaults", () => {
    const world = createWorld(tagRegistry);
    const entity = world.createEntity();

    world.addComponent(entity, "Transform");

    expect(world.hasComponent(entity, "Transform")).toBe(true);
    expect(world.getComponent(entity, "Transform")).toEqual({ x: 0 });
  });
});

describe("forEachEntity", () => {
  const registry = {
    Transform: s.object({ x: s.number() }),
  };

  it("iterates all alive entities via callback", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    const e3 = world.createEntity();

    const collected: number[] = [];
    world.forEachEntity((entity) => collected.push(entity));

    expect(collected).toHaveLength(3);
    expect(collected).toContain(e1);
    expect(collected).toContain(e2);
    expect(collected).toContain(e3);
  });

  it("skips destroyed entities", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    const e3 = world.createEntity();

    world.destroyEntity(e2);

    const collected: number[] = [];
    world.forEachEntity((entity) => collected.push(entity));

    expect(collected).toHaveLength(2);
    expect(collected).toContain(e1);
    expect(collected).not.toContain(e2);
    expect(collected).toContain(e3);
  });

  it("collects no entities on an empty world", () => {
    const world = createWorld(registry);

    const collected: number[] = [];
    world.forEachEntity((entity) => collected.push(entity));

    expect(collected).toHaveLength(0);
  });
});

describe("Component defaults at addition time", () => {
  const registry = {
    Position: s.object({ x: s.number(), y: s.number() }),
    Label: s.object({ name: s.string() }),
    Visible: s.tag(),
  };

  it("addComponent without data uses schema defaults", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    world.addComponent(entity, "Position");

    expect(world.hasComponent(entity, "Position")).toBe(true);
    expect(world.getComponent(entity, "Position")).toEqual({ x: 0, y: 0 });
  });

  it("addComponent with data uses provided data", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    world.addComponent(entity, "Position", { x: 5, y: 10 });

    expect(world.getComponent(entity, "Position")).toEqual({ x: 5, y: 10 });
  });

  it("default values are independent per call (no shared references)", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    const e2 = world.createEntity();

    world.addComponent(e1, "Position");
    world.addComponent(e2, "Position");

    const c1 = world.getComponent(e1, "Position")!;
    const c2 = world.getComponent(e2, "Position")!;

    // Mutating one should not affect the other
    c1.x = 99;
    expect(c2.x).toBe(0);
  });

  it("string schema defaults to empty string", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    world.addComponent(entity, "Label");

    expect(world.getComponent(entity, "Label")).toEqual({ name: "" });
  });

  it("tag components still work without data", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    world.addComponent(entity, "Visible");

    expect(world.getComponent(entity, "Visible")).toBe(true);
  });
});

describe("change tracking returns ReadonlySet", () => {
  const registry = {
    Transform: s.object({ x: s.number() }),
  };

  it("getAdded returns a Set containing the added entity", () => {
    const world = createWorld(registry);
    world.beginFrame();
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 1 });

    const added = world.getAdded("Transform");
    expect(added).toBeInstanceOf(Set);
    expect(added.has(entity)).toBe(true);
    expect(added.size).toBe(1);
  });

  it("getRemoved returns a Set containing the removed entity", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 1 });
    world.beginFrame();
    world.removeComponent(entity, "Transform");

    const removed = world.getRemoved("Transform");
    expect(removed).toBeInstanceOf(Set);
    expect(removed.has(entity)).toBe(true);
    expect(removed.size).toBe(1);
  });

  it("getUpdated returns a Set containing the updated entity", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 1 });
    world.beginFrame();
    world.addComponent(entity, "Transform", { x: 2 });

    const updated = world.getUpdated("Transform");
    expect(updated).toBeInstanceOf(Set);
    expect(updated.has(entity)).toBe(true);
    expect(updated.size).toBe(1);
  });

  it("empty change sets are empty Sets", () => {
    const world = createWorld(registry);
    world.beginFrame();

    const added = world.getAdded("Transform");
    expect(added).toBeInstanceOf(Set);
    expect(added.size).toBe(0);
  });
});

describe("Resources / singletons", () => {
  const registry = {
    Transform: s.object({ x: s.number() }),
  };

  const resourceRegistry = {
    Time: s.object({ delta: s.number(), elapsed: s.number() }),
    Config: s.object({ debug: s.boolean() }),
  };

  it("set and get a resource", () => {
    const world = createWorld(registry, { resources: resourceRegistry });

    world.setResource("Time", { delta: 0.016, elapsed: 1.5 });

    expect(world.getResource("Time")).toEqual({ delta: 0.016, elapsed: 1.5 });
  });

  it("hasResource returns false when not set, true when set", () => {
    const world = createWorld(registry, { resources: resourceRegistry });

    expect(world.hasResource("Time")).toBe(false);

    world.setResource("Time", { delta: 0, elapsed: 0 });

    expect(world.hasResource("Time")).toBe(true);
  });

  it("getResource returns undefined when not set", () => {
    const world = createWorld(registry, { resources: resourceRegistry });

    expect(world.getResource("Time")).toBeUndefined();
  });

  it("setResource overwrites previous value", () => {
    const world = createWorld(registry, { resources: resourceRegistry });

    world.setResource("Config", { debug: false });
    expect(world.getResource("Config")).toEqual({ debug: false });

    world.setResource("Config", { debug: true });
    expect(world.getResource("Config")).toEqual({ debug: true });
  });

  it("resources are not affected by beginFrame/endFrame", () => {
    const world = createWorld(registry, { resources: resourceRegistry });

    world.setResource("Time", { delta: 0.016, elapsed: 1.0 });

    world.beginFrame();
    expect(world.getResource("Time")).toEqual({ delta: 0.016, elapsed: 1.0 });

    world.endFrame();
    expect(world.getResource("Time")).toEqual({ delta: 0.016, elapsed: 1.0 });
  });

  it("resources are not affected by flushChanges", () => {
    const world = createWorld(registry, { resources: resourceRegistry });

    world.setResource("Config", { debug: true });
    world.flushChanges();

    expect(world.getResource("Config")).toEqual({ debug: true });
    expect(world.hasResource("Config")).toBe(true);
  });

  it("multiple resources are independent", () => {
    const world = createWorld(registry, { resources: resourceRegistry });

    world.setResource("Time", { delta: 0.016, elapsed: 0 });
    world.setResource("Config", { debug: true });

    expect(world.getResource("Time")).toEqual({ delta: 0.016, elapsed: 0 });
    expect(world.getResource("Config")).toEqual({ debug: true });
  });

  it("world without resource registry has no resource methods that accept keys", () => {
    const world = createWorld(registry);

    // No resources registered, so calling with any key should throw
    // TypeScript would prevent this at compile time, but we verify runtime behavior
    expect(() => (world as any).setResource("Foo", {})).toThrow(/unknown resource/i);
    expect(() => (world as any).getResource("Foo")).toThrow(/unknown resource/i);
    expect(() => (world as any).hasResource("Foo")).toThrow(/unknown resource/i);
  });

  it("setResource throws for unregistered resource type", () => {
    const world = createWorld(registry, { resources: resourceRegistry });

    expect(() => (world as any).setResource("Unknown", {})).toThrow(/unknown resource/i);
  });
});

describe("World clear / reset", () => {
  const registry = {
    Transform: s.object({ x: s.number() }),
    Name: s.object({ label: s.string() }),
    Visible: s.tag(),
  };

  it("clear() sets entityCount to 0", () => {
    const world = createWorld(registry);
    world.createEntity();
    world.createEntity();
    world.createEntity();

    world.clear();

    expect(world.entityCount).toBe(0);
  });

  it("clear() makes old entity IDs no longer alive", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    world.addComponent(e1, "Transform", { x: 1 });
    world.addComponent(e2, "Name", { label: "test" });

    world.clear();

    expect(world.isAlive(e1)).toBe(false);
    expect(world.isAlive(e2)).toBe(false);
  });

  it("clear() empties all component stores", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    world.addComponent(e1, "Transform", { x: 1 });
    world.addComponent(e2, "Transform", { x: 2 });
    world.addComponent(e1, "Name", { label: "hero" });
    world.addComponent(e2, "Visible");

    world.clear();

    expect(world.componentCount("Transform")).toBe(0);
    expect(world.componentCount("Name")).toBe(0);
    expect(world.componentCount("Visible")).toBe(0);
  });

  it("clear() fires destroy listeners for each alive entity", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    const e3 = world.createEntity();
    world.addComponent(e1, "Transform", { x: 1 });
    world.addComponent(e2, "Transform", { x: 2 });

    const destroyed: number[] = [];
    world.onEntityDestroyed((entity) => destroyed.push(entity));

    world.clear();

    expect(destroyed).toHaveLength(3);
    expect(destroyed).toContain(e1);
    expect(destroyed).toContain(e2);
    expect(destroyed).toContain(e3);
  });

  it("destroy listeners can access components during clear()", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    world.addComponent(e1, "Transform", { x: 42 });

    let observedTransform: { x: number } | undefined;
    world.onEntityDestroyed((entity) => {
      observedTransform = world.getComponent(entity, "Transform");
    });

    world.clear();

    expect(observedTransform).toEqual({ x: 42 });
  });

  it("new entities can be created after clear()", () => {
    const world = createWorld(registry);
    const oldEntity = world.createEntity();
    world.addComponent(oldEntity, "Transform", { x: 1 });

    world.clear();

    const newEntity = world.createEntity();
    expect(world.isAlive(newEntity)).toBe(true);
    expect(world.entityCount).toBe(1);

    world.addComponent(newEntity, "Transform", { x: 99 });
    expect(world.getComponent(newEntity, "Transform")).toEqual({ x: 99 });
  });

  it("clear() flushes change tracking", () => {
    const world = createWorld(registry);
    world.beginFrame();
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 1 });

    // There should be an added change before clear
    expect(world.getAdded("Transform").size).toBe(1);

    world.clear();

    // After clear, change tracking should be flushed
    expect(world.getAdded("Transform").size).toBe(0);
    expect(world.getRemoved("Transform").size).toBe(0);
    expect(world.getUpdated("Transform").size).toBe(0);
  });

  it("stats() reflects empty state after clear()", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    world.addComponent(e1, "Transform", { x: 1 });
    world.addComponent(e1, "Visible");

    world.clear();

    const result = world.stats();
    expect(result.entities).toBe(0);
    expect(result.components).toEqual({
      Transform: 0,
      Name: 0,
      Visible: 0,
    });
  });
});

describe("Batch entity creation (spawn)", () => {
  const registry = {
    Transform: s.object({ x: s.number(), y: s.number() }),
    Name: s.object({ label: s.string() }),
    Visible: s.tag(),
  };

  it("spawn creates the requested number of entities", () => {
    const world = createWorld(registry);
    const entities = world.spawn(10);

    expect(entities).toHaveLength(10);
    expect(world.entityCount).toBe(10);
    for (const e of entities) {
      expect(world.isAlive(e)).toBe(true);
    }
  });

  it("spawn with static component values applies to all entities", () => {
    const world = createWorld(registry);
    const entities = world.spawn(5, {
      Transform: { x: 1, y: 2 },
    });

    expect(entities).toHaveLength(5);
    for (const e of entities) {
      expect(world.hasComponent(e, "Transform")).toBe(true);
      expect(world.getComponent(e, "Transform")).toEqual({ x: 1, y: 2 });
    }
  });

  it("spawn with factory function receives index parameter", () => {
    const world = createWorld(registry);
    const entities = world.spawn(3, {
      Transform: (i) => ({ x: i * 10, y: i * 20 }),
    });

    expect(entities).toHaveLength(3);
    expect(world.getComponent(entities[0], "Transform")).toEqual({ x: 0, y: 0 });
    expect(world.getComponent(entities[1], "Transform")).toEqual({ x: 10, y: 20 });
    expect(world.getComponent(entities[2], "Transform")).toEqual({ x: 20, y: 40 });
  });

  it("spawn with multiple component types", () => {
    const world = createWorld(registry);
    const entities = world.spawn(2, {
      Transform: (i) => ({ x: i, y: i }),
      Name: { label: "unit" },
      Visible: true as any,
    });

    expect(entities).toHaveLength(2);
    for (const e of entities) {
      expect(world.hasComponent(e, "Transform")).toBe(true);
      expect(world.hasComponent(e, "Name")).toBe(true);
      expect(world.hasComponent(e, "Visible")).toBe(true);
      expect(world.getComponent(e, "Name")).toEqual({ label: "unit" });
      expect(world.getComponent(e, "Visible")).toBe(true);
    }
    expect(world.getComponent(entities[0], "Transform")).toEqual({ x: 0, y: 0 });
    expect(world.getComponent(entities[1], "Transform")).toEqual({ x: 1, y: 1 });
  });

  it("spawn records all entities as added in change tracking", () => {
    const world = createWorld(registry);
    world.beginFrame();

    const entities = world.spawn(3, {
      Transform: { x: 0, y: 0 },
    });

    const added = world.getAdded("Transform");
    expect(added.size).toBe(3);
    for (const e of entities) {
      expect(added.has(e)).toBe(true);
    }
  });

  it("spawn with count 0 returns empty array", () => {
    const world = createWorld(registry);
    const entities = world.spawn(0, {
      Transform: { x: 1, y: 1 },
    });

    expect(entities).toHaveLength(0);
    expect(world.entityCount).toBe(0);
  });

  it("spawn without factories creates bare entities", () => {
    const world = createWorld(registry);
    const entities = world.spawn(3);

    expect(entities).toHaveLength(3);
    for (const e of entities) {
      expect(world.isAlive(e)).toBe(true);
      expect(world.hasComponent(e, "Transform")).toBe(false);
      expect(world.hasComponent(e, "Name")).toBe(false);
    }
  });
});

describe("Entity count and debug stats", () => {
  const registry = {
    Transform: s.object({ x: s.number() }),
    Name: s.object({ label: s.string() }),
    Visible: s.tag(),
  };

  it("entityCount is 0 on a fresh world", () => {
    const world = createWorld(registry);
    expect(world.entityCount).toBe(0);
  });

  it("entityCount increases after creating entities", () => {
    const world = createWorld(registry);
    world.createEntity();
    expect(world.entityCount).toBe(1);
    world.createEntity();
    expect(world.entityCount).toBe(2);
  });

  it("entityCount decreases after destroying entities", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    expect(world.entityCount).toBe(2);

    world.destroyEntity(e1);
    expect(world.entityCount).toBe(1);

    world.destroyEntity(e2);
    expect(world.entityCount).toBe(0);
  });

  it("componentCount returns 0 when no entities have the component", () => {
    const world = createWorld(registry);
    world.createEntity();
    expect(world.componentCount("Transform")).toBe(0);
  });

  it("componentCount returns correct count after add/remove", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    const e3 = world.createEntity();

    world.addComponent(e1, "Transform", { x: 1 });
    world.addComponent(e2, "Transform", { x: 2 });
    expect(world.componentCount("Transform")).toBe(2);

    world.addComponent(e3, "Name", { label: "test" });
    expect(world.componentCount("Name")).toBe(1);

    world.removeComponent(e1, "Transform");
    expect(world.componentCount("Transform")).toBe(1);
  });

  it("componentCount updates when entity is destroyed", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    world.addComponent(e1, "Transform", { x: 1 });
    world.addComponent(e1, "Name", { label: "hero" });

    expect(world.componentCount("Transform")).toBe(1);
    expect(world.componentCount("Name")).toBe(1);

    world.destroyEntity(e1);

    expect(world.componentCount("Transform")).toBe(0);
    expect(world.componentCount("Name")).toBe(0);
  });

  it("componentCount throws for unknown component type", () => {
    const world = createWorld(registry);
    expect(() => (world as any).componentCount("Unknown")).toThrow(/unknown component/i);
  });

  it("stats() returns correct shape and values", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    const e2 = world.createEntity();

    world.addComponent(e1, "Transform", { x: 1 });
    world.addComponent(e2, "Transform", { x: 2 });
    world.addComponent(e1, "Name", { label: "hero" });
    world.addComponent(e2, "Visible");

    const result = world.stats();

    expect(result.entities).toBe(2);
    expect(result.components).toEqual({
      Transform: 2,
      Name: 1,
      Visible: 1,
    });
  });

  it("stats() reflects changes after destroy", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    const e2 = world.createEntity();

    world.addComponent(e1, "Transform", { x: 1 });
    world.addComponent(e2, "Transform", { x: 2 });
    world.addComponent(e1, "Name", { label: "hero" });

    world.destroyEntity(e1);

    const result = world.stats();
    expect(result.entities).toBe(1);
    expect(result.components).toEqual({
      Transform: 1,
      Name: 0,
      Visible: 0,
    });
  });

  it("stats() returns zeros on empty world", () => {
    const world = createWorld(registry);
    const result = world.stats();

    expect(result.entities).toBe(0);
    expect(result.components).toEqual({
      Transform: 0,
      Name: 0,
      Visible: 0,
    });
  });
});
