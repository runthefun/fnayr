import { describe, expect, it } from "vitest";
import { s } from "../schema";
import { EventBus } from "./events";
import { createWorld } from "./world";

describe("EventBus", () => {
  const eventRegistry = {
    Collision: s.object({ a: s.number(), b: s.number() }),
    Damage: s.object({ target: s.number(), amount: s.number() }),
  };

  it("emits and reads events in the same frame", () => {
    const bus = new EventBus(eventRegistry);
    bus.emit("Collision", { a: 1, b: 2 });
    bus.emit("Collision", { a: 3, b: 4 });

    const events = bus.read("Collision");
    expect(events).toEqual([
      { a: 1, b: 2 },
      { a: 3, b: 4 },
    ]);
  });

  it("returns empty array when no events emitted", () => {
    const bus = new EventBus(eventRegistry);
    expect(bus.read("Collision")).toEqual([]);
  });

  it("clears events on flush", () => {
    const bus = new EventBus(eventRegistry);
    bus.emit("Collision", { a: 1, b: 2 });
    expect(bus.read("Collision")).toHaveLength(1);

    bus.flush();
    expect(bus.read("Collision")).toEqual([]);
  });

  it("keeps different event types independent", () => {
    const bus = new EventBus(eventRegistry);
    bus.emit("Collision", { a: 1, b: 2 });
    bus.emit("Damage", { target: 1, amount: 10 });

    expect(bus.read("Collision")).toEqual([{ a: 1, b: 2 }]);
    expect(bus.read("Damage")).toEqual([{ target: 1, amount: 10 }]);
  });

  it("multiple events of same type accumulate", () => {
    const bus = new EventBus(eventRegistry);
    bus.emit("Damage", { target: 1, amount: 5 });
    bus.emit("Damage", { target: 2, amount: 10 });
    bus.emit("Damage", { target: 3, amount: 15 });

    const events = bus.read("Damage");
    expect(events).toHaveLength(3);
    expect(events[2]).toEqual({ target: 3, amount: 15 });
  });

  it("throws on unknown event type for emit", () => {
    const bus = new EventBus(eventRegistry);
    expect(() =>
      (bus as any).emit("Unknown", {})
    ).toThrow(/unknown event type/i);
  });

  it("throws on unknown event type for read", () => {
    const bus = new EventBus(eventRegistry);
    expect(() =>
      (bus as any).read("Unknown")
    ).toThrow(/unknown event type/i);
  });
});

describe("World events integration", () => {
  const registry = {
    Transform: s.object({ x: s.number() }),
  };
  const resources = {};
  const events = {
    Collision: s.object({ a: s.number(), b: s.number() }),
    Damage: s.object({ target: s.number(), amount: s.number() }),
  };

  it("emit and read events through the world", () => {
    const world = createWorld(registry, { resources, events });
    world.emit("Collision", { a: 1, b: 2 });

    const collisions = world.read("Collision");
    expect(collisions).toEqual([{ a: 1, b: 2 }]);
  });

  it("events are cleared on beginFrame", () => {
    const world = createWorld(registry, { resources, events });
    world.emit("Collision", { a: 1, b: 2 });
    expect(world.read("Collision")).toHaveLength(1);

    world.beginFrame();
    expect(world.read("Collision")).toEqual([]);
  });

  it("events survive within the same frame", () => {
    const world = createWorld(registry, { resources, events });
    world.beginFrame();
    world.emit("Damage", { target: 1, amount: 10 });
    world.emit("Damage", { target: 2, amount: 20 });

    // Simulate a later system reading events in the same frame
    const dmg = world.read("Damage");
    expect(dmg).toHaveLength(2);
    expect(dmg[0]).toEqual({ target: 1, amount: 10 });
    expect(dmg[1]).toEqual({ target: 2, amount: 20 });
  });

  it("events are not cleared on endFrame", () => {
    const world = createWorld(registry, { resources, events });
    world.emit("Collision", { a: 5, b: 6 });
    world.endFrame();

    // endFrame clears change tracking but not events
    expect(world.read("Collision")).toHaveLength(1);
  });

  it("different event types are independent through the world", () => {
    const world = createWorld(registry, { resources, events });
    world.emit("Collision", { a: 1, b: 2 });
    world.emit("Damage", { target: 3, amount: 30 });

    expect(world.read("Collision")).toHaveLength(1);
    expect(world.read("Damage")).toHaveLength(1);

    // Only collision should clear on next beginFrame
    world.beginFrame();
    expect(world.read("Collision")).toEqual([]);
    expect(world.read("Damage")).toEqual([]);
  });

  it("throws when emitting on a world without event registry", () => {
    const world = createWorld(registry);
    expect(() =>
      (world as any).emit("Collision", { a: 1, b: 2 })
    ).toThrow(/no event registry/i);
  });

  it("throws when reading on a world without event registry", () => {
    const world = createWorld(registry);
    expect(() =>
      (world as any).read("Collision")
    ).toThrow(/no event registry/i);
  });
});
