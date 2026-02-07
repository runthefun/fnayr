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
    world.setComponent(entity, "Transform", { x: 1 });

    expect(world.getAdded("Transform")).toEqual(new Set([entity]));
    expect(world.getRemoved("Transform")).toEqual(new Set());

    world.endFrame();

    expect(world.getAdded("Transform")).toEqual(new Set());

    world.beginFrame();
    world.removeComponent(entity, "Transform");

    expect(world.getRemoved("Transform")).toEqual(new Set([entity]));
  });

  it("tracks updated component data", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.setComponent(entity, "Transform", { x: 2 });

    world.beginFrame();
    world.setComponent(entity, "Transform", { x: 3 });

    expect(world.getUpdated("Transform")).toEqual(new Set([entity]));
  });

  it("clears changes between frames", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    world.beginFrame();
    world.setComponent(entity, "Name", { label: "Hero" });
    expect(world.getAdded("Name")).toEqual(new Set([entity]));

    world.endFrame();

    expect(world.getAdded("Name")).toEqual(new Set());
    expect(world.getRemoved("Name")).toEqual(new Set());
    expect(world.getUpdated("Name")).toEqual(new Set());
  });
});
