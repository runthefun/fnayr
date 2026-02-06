import { describe, expect, it } from "vitest";
import { ecs, s } from "../index";

describe("ECS runtime example", () => {
  it("runs a simple system loop", () => {
    const registry = {
      Transform: s.object({ x: s.number() }),
      Velocity: s.object({ x: s.number() }),
    };

    const world = ecs.createWorld(registry);
    const entity = world.createEntity();
    world.addComponent(entity, "Transform", { x: 0 });
    world.addComponent(entity, "Velocity", { x: 2 });

    const scheduler = new ecs.Scheduler(world);
    scheduler.addSystem((world, dt) => {
      for (const { entity, components } of world.query([
        "Transform",
        "Velocity",
      ])) {
        world.addComponent(entity, "Transform", {
          x: components.Transform.x + components.Velocity.x * dt,
        });
      }
    });

    world.beginFrame();
    scheduler.runFrame(0.5);
    world.endFrame();

    expect(world.getComponent(entity, "Transform")?.x).toBe(1);
  });
});
