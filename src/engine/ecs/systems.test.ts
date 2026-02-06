import { describe, expect, it } from "vitest";
import { s } from "../schema";
import { createWorld } from "./world";
import { Scheduler } from "./systems";

describe("Scheduler", () => {
  const registry = {
    Transform: s.object({ x: s.number() }),
  };

  it("runs systems in insertion order", () => {
    const world = createWorld(registry);
    const scheduler = new Scheduler(world);
    const calls: string[] = [];

    scheduler.addSystem(() => calls.push("first"));
    scheduler.addSystem(() => calls.push("second"));

    scheduler.runFrame(0.016);

    expect(calls).toEqual(["first", "second"]);
  });

  it("allows systems to query and mutate the world", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 1 });

    const scheduler = new Scheduler(world);
    scheduler.addSystem((world, dt) => {
      for (const { entity, components } of world.query(["Transform"])) {
        world.addComponent(entity, "Transform", {
          x: components.Transform.x + dt,
        });
      }
    });

    scheduler.runFrame(2);

    expect(world.getComponent(entity, "Transform")?.x).toBe(3);
  });
});
