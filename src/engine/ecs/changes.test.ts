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
    world.beginFrame();
    world.setComponent(entity, "Transform", { x: 2 });
    world.endFrame();

    world.beginFrame();
    world.setComponent(entity, "Transform", { x: 3 });

    expect(world.getUpdated("Transform")).toEqual(new Set([entity]));
  });

  it("preserves changes made between frames (e.g. editor UI updates)", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    // Frame 1: add the component
    world.beginFrame();
    world.setComponent(entity, "Transform", { x: 1 });
    world.endFrame();

    // Between frames: simulate an editor/inspector updating the component
    world.setComponent(entity, "Transform", { x: 42 });

    // Frame 2: the update should be visible to systems
    world.beginFrame();
    expect(world.getUpdated("Transform")).toEqual(new Set([entity]));
    world.endFrame();
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
