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
});
