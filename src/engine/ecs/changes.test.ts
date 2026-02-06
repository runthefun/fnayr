import { describe, expect, it } from "vitest";
import { s } from "../schema";
import { createWorld } from "./world";

describe("EcsWorld change tracking", () => {
  const registry = {
    Transform: s.object({ x: s.number() }),
    Name: s.object({ label: s.string() }),
  };

  it("tracks added and removed components per frame", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    world.beginFrame();
    world.addComponent(entity, "Transform", { x: 1 });

    expect(world.getAdded("Transform")).toEqual([entity]);
    expect(world.getRemoved("Transform")).toEqual([]);

    world.endFrame();

    expect(world.getAdded("Transform")).toEqual([]);

    world.beginFrame();
    world.removeComponent(entity, "Transform");

    expect(world.getRemoved("Transform")).toEqual([entity]);
  });

  it("tracks updated component data", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 2 });

    world.beginFrame();
    world.addComponent(entity, "Transform", { x: 3 });

    expect(world.getUpdated("Transform")).toEqual([entity]);
  });

  it("clears changes between frames", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    world.beginFrame();
    world.addComponent(entity, "Name", { label: "Hero" });
    expect(world.getAdded("Name")).toEqual([entity]);

    world.endFrame();

    expect(world.getAdded("Name")).toEqual([]);
    expect(world.getRemoved("Name")).toEqual([]);
    expect(world.getUpdated("Name")).toEqual([]);
  });
});
