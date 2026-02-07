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
    world.setComponent(entity, "Transform", { x: 1 });

    const scheduler = new Scheduler(world);
    scheduler.addSystem((world, dt) => {
      for (const { entity, components } of world.query(["Transform"])) {
        world.setComponent(entity, "Transform", {
          x: components.Transform.x + dt,
        });
      }
    });

    scheduler.runFrame(2);

    expect(world.getComponent(entity, "Transform")?.x).toBe(3);
  });

  it("calls beginFrame at start and endFrame at end of runFrame", () => {
    const world = createWorld(registry);
    const entity = world.createEntity();
    world.setComponent(entity, "Transform", { x: 0 });

    // Flush the 'added' tracking from setup
    world.beginFrame();
    world.endFrame();

    const scheduler = new Scheduler(world);
    let addedDuringFrame = false;

    scheduler.addSystem((w) => {
      // Update a component inside the system (already exists, so records as updated)
      w.setComponent(entity, "Transform", { x: 5 });
      addedDuringFrame = w.getUpdated("Transform").has(entity);
    });

    scheduler.runFrame(0.016);

    // During the system, the change should be visible
    expect(addedDuringFrame).toBe(true);
    // After runFrame (endFrame was called), changes are flushed
    expect(world.getUpdated("Transform").size).toBe(0);
  });

  describe("phases", () => {
    it("executes phases in declared order", () => {
      const world = createWorld(registry);
      const scheduler = new Scheduler(world, ["input", "update", "render"]);
      const calls: string[] = [];

      scheduler.addSystem("render", () => calls.push("render"));
      scheduler.addSystem("input", () => calls.push("input"));
      scheduler.addSystem("update", () => calls.push("update"));

      scheduler.runFrame(0.016);

      expect(calls).toEqual(["input", "update", "render"]);
    });

    it("executes systems within a phase in insertion order", () => {
      const world = createWorld(registry);
      const scheduler = new Scheduler(world, ["update"]);
      const calls: string[] = [];

      scheduler.addSystem("update", () => calls.push("A"));
      scheduler.addSystem("update", () => calls.push("B"));
      scheduler.addSystem("update", () => calls.push("C"));

      scheduler.runFrame(0.016);

      expect(calls).toEqual(["A", "B", "C"]);
    });

    it("addSystem without phase uses 'update' (backward compatible)", () => {
      const world = createWorld(registry);
      const scheduler = new Scheduler(world, ["pre", "update", "post"]);
      const calls: string[] = [];

      scheduler.addSystem("pre", () => calls.push("pre"));
      scheduler.addSystem(() => calls.push("update"));
      scheduler.addSystem("post", () => calls.push("post"));

      scheduler.runFrame(0.016);

      expect(calls).toEqual(["pre", "update", "post"]);
    });

    it("throws when adding to an unknown phase", () => {
      const world = createWorld(registry);
      const scheduler = new Scheduler(world, ["update"]);

      expect(() => {
        scheduler.addSystem("nonexistent", () => {});
      }).toThrow("Unknown phase: nonexistent");
    });
  });

  describe("removeSystem", () => {
    it("removes a system from the schedule", () => {
      const world = createWorld(registry);
      const scheduler = new Scheduler(world);
      const calls: string[] = [];

      const sysA = () => calls.push("A");
      const sysB = () => calls.push("B");

      scheduler.addSystem(sysA);
      scheduler.addSystem(sysB);

      scheduler.removeSystem(sysA);
      scheduler.runFrame(0.016);

      expect(calls).toEqual(["B"]);
    });

    it("removeSystem is a no-op for an unregistered system", () => {
      const world = createWorld(registry);
      const scheduler = new Scheduler(world);

      // Should not throw
      scheduler.removeSystem(() => {});
    });
  });

  describe("enableSystem / disableSystem", () => {
    it("disabling a system skips it during runFrame", () => {
      const world = createWorld(registry);
      const scheduler = new Scheduler(world);
      const calls: string[] = [];

      const sysA = () => calls.push("A");
      const sysB = () => calls.push("B");

      scheduler.addSystem(sysA);
      scheduler.addSystem(sysB);

      scheduler.disableSystem(sysA);
      scheduler.runFrame(0.016);

      expect(calls).toEqual(["B"]);
    });

    it("re-enabling a disabled system includes it again", () => {
      const world = createWorld(registry);
      const scheduler = new Scheduler(world);
      const calls: string[] = [];

      const sys = () => calls.push("run");

      scheduler.addSystem(sys);
      scheduler.disableSystem(sys);
      scheduler.runFrame(0.016);

      expect(calls).toEqual([]);

      scheduler.enableSystem(sys);
      scheduler.runFrame(0.016);

      expect(calls).toEqual(["run"]);
    });

    it("disableSystem is a no-op for unregistered system", () => {
      const world = createWorld(registry);
      const scheduler = new Scheduler(world);

      // Should not throw
      scheduler.disableSystem(() => {});
    });
  });
});
