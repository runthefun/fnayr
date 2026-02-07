import { describe, expect, it } from "vitest";
import { s } from "../schema";
import { createWorld } from "./world";
import { Hierarchy } from "./hierarchy";

describe("Hierarchy", () => {
  const registry = {
    Transform: s.object({ x: s.number(), y: s.number() }),
    Name: s.object({ label: s.string() }),
  };

  function setup() {
    const world = createWorld(registry);
    const hierarchy = new Hierarchy(world);
    return { world, hierarchy };
  }

  it("sets and gets a parent-child relationship", () => {
    const { world, hierarchy } = setup();
    const parent = world.createEntity();
    const child = world.createEntity();

    hierarchy.setParent(child, parent);

    expect(hierarchy.getParent(child)).toBe(parent);
    expect(hierarchy.getChildren(parent)).toEqual([child]);
  });

  it("returns undefined for parentless entities", () => {
    const { world, hierarchy } = setup();
    const entity = world.createEntity();

    expect(hierarchy.getParent(entity)).toBeUndefined();
  });

  it("returns empty array for childless entities", () => {
    const { world, hierarchy } = setup();
    const entity = world.createEntity();

    expect(hierarchy.getChildren(entity)).toEqual([]);
  });

  it("supports multiple children", () => {
    const { world, hierarchy } = setup();
    const parent = world.createEntity();
    const c1 = world.createEntity();
    const c2 = world.createEntity();
    const c3 = world.createEntity();

    hierarchy.setParent(c1, parent);
    hierarchy.setParent(c2, parent);
    hierarchy.setParent(c3, parent);

    expect(hierarchy.getChildren(parent)).toEqual([c1, c2, c3]);
    expect(hierarchy.getParent(c1)).toBe(parent);
    expect(hierarchy.getParent(c2)).toBe(parent);
    expect(hierarchy.getParent(c3)).toBe(parent);
  });

  it("reparenting updates old and new parent children lists", () => {
    const { world, hierarchy } = setup();
    const oldParent = world.createEntity();
    const newParent = world.createEntity();
    const child = world.createEntity();

    hierarchy.setParent(child, oldParent);
    expect(hierarchy.getChildren(oldParent)).toEqual([child]);

    hierarchy.setParent(child, newParent);
    expect(hierarchy.getChildren(oldParent)).toEqual([]);
    expect(hierarchy.getChildren(newParent)).toEqual([child]);
    expect(hierarchy.getParent(child)).toBe(newParent);
  });

  it("removeParent orphans a child", () => {
    const { world, hierarchy } = setup();
    const parent = world.createEntity();
    const child = world.createEntity();

    hierarchy.setParent(child, parent);
    hierarchy.removeParent(child);

    expect(hierarchy.getParent(child)).toBeUndefined();
    expect(hierarchy.getChildren(parent)).toEqual([]);
  });

  it("removeParent is a no-op for parentless entities", () => {
    const { world, hierarchy } = setup();
    const entity = world.createEntity();

    // Should not throw
    hierarchy.removeParent(entity);
    expect(hierarchy.getParent(entity)).toBeUndefined();
  });

  it("isDescendantOf returns true for direct children", () => {
    const { world, hierarchy } = setup();
    const parent = world.createEntity();
    const child = world.createEntity();

    hierarchy.setParent(child, parent);

    expect(hierarchy.isDescendantOf(child, parent)).toBe(true);
    expect(hierarchy.isDescendantOf(parent, child)).toBe(false);
  });

  it("isDescendantOf returns true for deep descendants", () => {
    const { world, hierarchy } = setup();
    const grandparent = world.createEntity();
    const parent = world.createEntity();
    const child = world.createEntity();

    hierarchy.setParent(parent, grandparent);
    hierarchy.setParent(child, parent);

    expect(hierarchy.isDescendantOf(child, grandparent)).toBe(true);
    expect(hierarchy.isDescendantOf(parent, grandparent)).toBe(true);
    expect(hierarchy.isDescendantOf(grandparent, child)).toBe(false);
  });

  it("isDescendantOf returns false for unrelated entities", () => {
    const { world, hierarchy } = setup();
    const a = world.createEntity();
    const b = world.createEntity();

    expect(hierarchy.isDescendantOf(a, b)).toBe(false);
    expect(hierarchy.isDescendantOf(b, a)).toBe(false);
  });

  it("prevents setting an entity as its own parent", () => {
    const { world, hierarchy } = setup();
    const entity = world.createEntity();

    expect(() => hierarchy.setParent(entity, entity)).toThrow(/own parent/);
  });

  it("prevents cycles — child cannot be an ancestor of parent", () => {
    const { world, hierarchy } = setup();
    const a = world.createEntity();
    const b = world.createEntity();
    const c = world.createEntity();

    hierarchy.setParent(b, a);
    hierarchy.setParent(c, b);

    // Trying to make a child of c would create a cycle: a -> b -> c -> a
    expect(() => hierarchy.setParent(a, c)).toThrow(/cycle/);
  });

  it("throws when child entity is not alive", () => {
    const { world, hierarchy } = setup();
    const parent = world.createEntity();
    const child = world.createEntity();
    world.destroyEntity(child);

    expect(() => hierarchy.setParent(child, parent)).toThrow(/not alive/);
  });

  it("throws when parent entity is not alive", () => {
    const { world, hierarchy } = setup();
    const parent = world.createEntity();
    const child = world.createEntity();
    world.destroyEntity(parent);

    expect(() => hierarchy.setParent(child, parent)).toThrow(/not alive/);
  });

  it("destroying a parent cascades to all children", () => {
    const { world, hierarchy } = setup();
    const parent = world.createEntity();
    const child1 = world.createEntity();
    const child2 = world.createEntity();
    world.setComponent(parent, "Name", { label: "parent" });
    world.setComponent(child1, "Name", { label: "child1" });
    world.setComponent(child2, "Name", { label: "child2" });

    hierarchy.setParent(child1, parent);
    hierarchy.setParent(child2, parent);

    world.destroyEntity(parent);

    expect(world.isAlive(parent)).toBe(false);
    expect(world.isAlive(child1)).toBe(false);
    expect(world.isAlive(child2)).toBe(false);
  });

  it("destroying a parent cascades to grandchildren", () => {
    const { world, hierarchy } = setup();
    const grandparent = world.createEntity();
    const parent = world.createEntity();
    const child = world.createEntity();

    hierarchy.setParent(parent, grandparent);
    hierarchy.setParent(child, parent);

    world.destroyEntity(grandparent);

    expect(world.isAlive(grandparent)).toBe(false);
    expect(world.isAlive(parent)).toBe(false);
    expect(world.isAlive(child)).toBe(false);
  });

  it("destroying a child removes it from parent's children list", () => {
    const { world, hierarchy } = setup();
    const parent = world.createEntity();
    const child1 = world.createEntity();
    const child2 = world.createEntity();

    hierarchy.setParent(child1, parent);
    hierarchy.setParent(child2, parent);

    world.destroyEntity(child1);

    expect(hierarchy.getChildren(parent)).toEqual([child2]);
    expect(hierarchy.getParent(child1)).toBeUndefined();
  });

  it("hierarchy state is cleaned up after cascade destroy", () => {
    const { world, hierarchy } = setup();
    const parent = world.createEntity();
    const child = world.createEntity();

    hierarchy.setParent(child, parent);
    world.destroyEntity(parent);

    // All hierarchy state should be cleaned up
    expect(hierarchy.getParent(child)).toBeUndefined();
    expect(hierarchy.getChildren(parent)).toEqual([]);
    expect(hierarchy.getParent(parent)).toBeUndefined();
  });

  it("new entities after destruction are not affected by old hierarchy", () => {
    const { world, hierarchy } = setup();
    const parent = world.createEntity();
    const child = world.createEntity();

    hierarchy.setParent(child, parent);
    world.destroyEntity(parent);

    // Create new entities that may reuse indices
    const newEntity1 = world.createEntity();
    const newEntity2 = world.createEntity();

    expect(hierarchy.getParent(newEntity1)).toBeUndefined();
    expect(hierarchy.getParent(newEntity2)).toBeUndefined();
    expect(hierarchy.getChildren(newEntity1)).toEqual([]);
    expect(hierarchy.getChildren(newEntity2)).toEqual([]);
  });
});
