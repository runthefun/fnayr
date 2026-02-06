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

  it("throws when addComponent is called without data for non-tag component", () => {
    const world = createWorld(tagRegistry);
    const entity = world.createEntity();

    expect(() =>
      world.addComponent(entity, "Transform")
    ).toThrow(/required/i);
  });
});
