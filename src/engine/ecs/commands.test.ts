import { describe, expect, it } from "vitest";
import { s } from "../schema";
import { createWorld } from "./world";
import { CommandBuffer } from "./commands";
import { Scheduler } from "./systems";

const registry = {
  Transform: s.object({ x: s.number(), y: s.number() }),
  Health: s.object({ hp: s.number() }),
  Tag: s.tag(),
};

describe("CommandBuffer", () => {
  it("createEntity returns a valid, immediately alive entity", () => {
    const world = createWorld(registry);
    const cmds = new CommandBuffer(world);

    const entity = cmds.createEntity();
    expect(world.isAlive(entity)).toBe(true);
  });

  it("destroyEntity is deferred until flush", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.setComponent(entity, "Transform", { x: 1, y: 2 });

    const cmds = new CommandBuffer(world);
    cmds.destroyEntity(entity);

    // Entity is still alive before flush
    expect(world.isAlive(entity)).toBe(true);
    expect(world.hasComponent(entity, "Transform")).toBe(true);

    cmds.flush();

    // Entity is dead after flush
    expect(world.isAlive(entity)).toBe(false);
  });

  it("setComponent is deferred until flush", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    const cmds = new CommandBuffer(world);
    cmds.setComponent(entity, "Transform", { x: 5, y: 10 });

    // Component not yet added
    expect(world.hasComponent(entity, "Transform")).toBe(false);

    cmds.flush();

    // Component exists after flush
    expect(world.hasComponent(entity, "Transform")).toBe(true);
    expect(world.getComponent(entity, "Transform")).toEqual({ x: 5, y: 10 });
  });

  it("removeComponent is deferred until flush", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.setComponent(entity, "Transform", { x: 1, y: 2 });

    const cmds = new CommandBuffer(world);
    cmds.removeComponent(entity, "Transform");

    // Component still present before flush
    expect(world.hasComponent(entity, "Transform")).toBe(true);

    cmds.flush();

    // Component removed after flush
    expect(world.hasComponent(entity, "Transform")).toBe(false);
  });

  it("commands execute in order on flush", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    const cmds = new CommandBuffer(world);
    // Add then remove — net result: no component
    cmds.setComponent(entity, "Transform", { x: 1, y: 2 });
    cmds.removeComponent(entity, "Transform");

    cmds.flush();
    expect(world.hasComponent(entity, "Transform")).toBe(false);
  });

  it("createEntity can be used with subsequent setComponent in same buffer", () => {
    const world = createWorld(registry);

    const cmds = new CommandBuffer(world);
    const entity = cmds.createEntity();
    cmds.setComponent(entity, "Transform", { x: 3, y: 4 });
    cmds.setComponent(entity, "Health", { hp: 100 });

    cmds.flush();

    expect(world.hasComponent(entity, "Transform")).toBe(true);
    expect(world.getComponent(entity, "Transform")).toEqual({ x: 3, y: 4 });
    expect(world.getComponent(entity, "Health")).toEqual({ hp: 100 });
  });

  it("flush clears the buffer so subsequent flush is a no-op", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    const cmds = new CommandBuffer(world);
    cmds.setComponent(entity, "Transform", { x: 1, y: 1 });
    cmds.flush();

    // Remove the component directly
    world.removeComponent(entity, "Transform");
    expect(world.hasComponent(entity, "Transform")).toBe(false);

    // Second flush should not re-add
    cmds.flush();
    expect(world.hasComponent(entity, "Transform")).toBe(false);
  });

  it("setComponent works with tag components (no data arg)", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    const cmds = new CommandBuffer(world);
    cmds.setComponent(entity, "Tag");

    cmds.flush();
    expect(world.hasComponent(entity, "Tag")).toBe(true);
    expect(world.getComponent(entity, "Tag")).toBe(true);
  });
});

describe("CommandBuffer integration with Scheduler", () => {
  it("destroying via commands during query iteration does not affect iteration", () => {
    const world = createWorld(registry);
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    const e3 = world.createEntity();

    world.setComponent(e1, "Transform", { x: 1, y: 0 });
    world.setComponent(e2, "Transform", { x: 2, y: 0 });
    world.setComponent(e3, "Transform", { x: 3, y: 0 });

    const visited: number[] = [];

    const scheduler = new Scheduler(world);
    scheduler.addSystem((w, _dt, cmds) => {
      for (const { entity } of w.query(["Transform"])) {
        visited.push(entity);
        // Queue destruction of all entities via commands — should not affect iteration
        cmds.destroyEntity(entity);
      }
    });

    scheduler.runFrame(0.016);

    // All 3 entities were visited during iteration
    expect(visited).toHaveLength(3);
    expect(visited).toContain(e1);
    expect(visited).toContain(e2);
    expect(visited).toContain(e3);

    // After system flush, all entities are destroyed
    expect(world.isAlive(e1)).toBe(false);
    expect(world.isAlive(e2)).toBe(false);
    expect(world.isAlive(e3)).toBe(false);
  });

  it("commands are applied in order after system completes", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    const scheduler = new Scheduler(world);
    scheduler.addSystem((_w, _dt, cmds) => {
      cmds.setComponent(entity, "Transform", { x: 10, y: 20 });
      cmds.setComponent(entity, "Health", { hp: 50 });
    });

    scheduler.runFrame(0.016);

    expect(world.getComponent(entity, "Transform")).toEqual({ x: 10, y: 20 });
    expect(world.getComponent(entity, "Health")).toEqual({ hp: 50 });
  });

  it("existing systems that ignore commands still work", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.setComponent(entity, "Transform", { x: 0, y: 0 });

    const scheduler = new Scheduler(world);
    // System that only uses world and dt (ignores commands parameter)
    scheduler.addSystem((w, dt) => {
      for (const { entity, components } of w.query(["Transform"])) {
        w.setComponent(entity, "Transform", {
          x: components.Transform.x + dt,
          y: components.Transform.y,
        });
      }
    });

    scheduler.runFrame(1);

    expect(world.getComponent(entity, "Transform")).toEqual({ x: 1, y: 0 });
  });

  it("each system gets its own command buffer", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();

    const scheduler = new Scheduler(world);

    // First system adds a component via commands
    scheduler.addSystem((_w, _dt, cmds) => {
      cmds.setComponent(entity, "Transform", { x: 1, y: 2 });
    });

    // Second system checks the component was flushed from first system's commands
    let hasTransformInSecondSystem = false;
    scheduler.addSystem((w) => {
      hasTransformInSecondSystem = w.hasComponent(entity, "Transform");
    });

    scheduler.runFrame(0.016);

    // First system's commands were flushed before second system ran
    expect(hasTransformInSecondSystem).toBe(true);
  });
});
