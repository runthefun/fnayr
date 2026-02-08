import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { s } from "../schema";
import { createWorld } from "./world";

const registry = {
  Transform: s.object({ x: s.number() }),
};

const SLOT_COUNT = 8;

type Action =
  | { kind: "create"; slot: number }
  | { kind: "spawn"; count: number; withTransform: boolean; baseX: number }
  | { kind: "set"; slot: number; useDefault: boolean; x: number }
  | { kind: "remove"; slot: number }
  | { kind: "getMut"; slot: number; mutate: boolean; nextX: number }
  | { kind: "destroy"; slot: number }
  | { kind: "beginFrame" }
  | { kind: "endFrame" };

type ModelEntity = {
  alive: boolean;
  transform?: { x: number };
};

type Model = {
  entities: Map<number, ModelEntity>;
  slots: Array<number | undefined>;
  nextSlot: number;
  added: Set<number>;
  updated: Set<number>;
  removed: Set<number>;
};

function initModel(): Model {
  return {
    entities: new Map(),
    slots: Array.from({ length: SLOT_COUNT }, () => undefined),
    nextSlot: 0,
    added: new Set(),
    updated: new Set(),
    removed: new Set(),
  };
}

function flushChanges(model: Model): void {
  model.added.clear();
  model.updated.clear();
  model.removed.clear();
}

function recordAdded(model: Model, entity: number): void {
  model.removed.delete(entity);
  model.updated.delete(entity);
  model.added.add(entity);
}

function recordRemoved(model: Model, entity: number): void {
  if (model.added.delete(entity)) {
    model.updated.delete(entity);
    return;
  }
  model.updated.delete(entity);
  model.removed.add(entity);
}

function recordUpdated(model: Model, entity: number): void {
  if (model.added.has(entity)) return;
  model.updated.add(entity);
}

function applyCreate(model: Model, id: number, slot: number): void {
  model.entities.set(id, { alive: true });
  model.slots[slot] = id;
}

function applySpawn(model: Model, ids: number[], withTransform: boolean, baseX: number): void {
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    model.entities.set(id, { alive: true });
    model.slots[model.nextSlot % SLOT_COUNT] = id;
    model.nextSlot++;
    if (withTransform) {
      model.entities.get(id)!.transform = { x: baseX + i };
      recordAdded(model, id);
    }
  }
}

function applySet(model: Model, slot: number, useDefault: boolean, x: number): boolean {
  const id = model.slots[slot];
  if (id === undefined) return false;
  const entity = model.entities.get(id);
  if (!entity || !entity.alive) return false;

  const existed = !!entity.transform;
  entity.transform = { x: useDefault ? 0 : x };
  if (existed) {
    recordUpdated(model, id);
  } else {
    recordAdded(model, id);
  }
  return false;
}

function applyRemove(model: Model, slot: number): void {
  const id = model.slots[slot];
  if (id === undefined) return;
  const entity = model.entities.get(id);
  if (!entity || !entity.alive || !entity.transform) return;

  entity.transform = undefined;
  recordRemoved(model, id);
}

function applyGetMut(model: Model, slot: number, mutate: boolean, nextX: number): boolean {
  const id = model.slots[slot];
  if (id === undefined) return false;
  const entity = model.entities.get(id);
  if (!entity || !entity.alive || !entity.transform) return false;

  recordUpdated(model, id);
  if (mutate) {
    entity.transform.x = nextX;
  }
  return true;
}

function applyDestroy(model: Model, slot: number): void {
  const id = model.slots[slot];
  if (id === undefined) return;
  const entity = model.entities.get(id);
  if (!entity || !entity.alive) return;

  if (entity.transform) {
    entity.transform = undefined;
    recordRemoved(model, id);
  }
  entity.alive = false;
}

function toSet(values: Iterable<number>): Set<number> {
  return new Set(values);
}

function assertWorldMatchesModel(
  world: ReturnType<typeof createWorld<typeof registry>>,
  model: Model,
): void {
  const alive = [...model.entities].filter(([, e]) => e.alive).map(([id]) => id);
  const aliveSet = new Set(alive);

  expect(world.entityCount).toBe(alive.length);
  expect(toSet(world.entities())).toEqual(aliveSet);

  const stats = world.stats();
  expect(stats.entities).toBe(alive.length);

  let transformCount = 0;
  for (const [id, entity] of model.entities) {
    expect(world.isAlive(id)).toBe(entity.alive);
    expect(world.hasComponent(id, "Transform")).toBe(!!entity.alive && !!entity.transform);

    const value = world.getComponent(id, "Transform");
    if (entity.alive && entity.transform) {
      expect(value).toEqual({ x: entity.transform.x });
      transformCount++;
    } else {
      expect(value).toBeUndefined();
    }
  }

  expect(world.componentCount("Transform")).toBe(transformCount);
  expect(stats.components.Transform).toBe(transformCount);

  const added = world.getAdded("Transform");
  const updated = world.getUpdated("Transform");
  const removed = world.getRemoved("Transform");

  expect(added).toEqual(model.added);
  expect(updated).toEqual(model.updated);
  expect(removed).toEqual(model.removed);

  for (const id of added) {
    expect(updated.has(id)).toBe(false);
    expect(removed.has(id)).toBe(false);
  }
  for (const id of updated) {
    expect(removed.has(id)).toBe(false);
  }
}

const slotArb = fc.integer({ min: 0, max: SLOT_COUNT - 1 });
const xArb = fc.integer({ min: -20, max: 20 });

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ kind: fc.constant("create"), slot: slotArb }),
  fc.record({
    kind: fc.constant("spawn"),
    count: fc.integer({ min: 1, max: 3 }),
    withTransform: fc.boolean(),
    baseX: xArb,
  }),
  fc.record({
    kind: fc.constant("set"),
    slot: slotArb,
    useDefault: fc.boolean(),
    x: xArb,
  }),
  fc.record({ kind: fc.constant("remove"), slot: slotArb }),
  fc.record({
    kind: fc.constant("getMut"),
    slot: slotArb,
    mutate: fc.boolean(),
    nextX: xArb,
  }),
  fc.record({ kind: fc.constant("destroy"), slot: slotArb }),
  fc.constant({ kind: "beginFrame" }),
  fc.constant({ kind: "endFrame" }),
);

describe("EcsWorld (property-based)", () => {
  it("preserves entity/component/change-tracking invariants across random frame operations", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { minLength: 1, maxLength: 120 }), (actions) => {
        const world = createWorld(registry);
        const model = initModel();

        assertWorldMatchesModel(world, model);

        for (const action of actions) {
          switch (action.kind) {
            case "create": {
              const id = world.createEntity();
              applyCreate(model, id, action.slot);
              break;
            }

            case "spawn": {
              const factories = action.withTransform
                ? { Transform: (i: number) => ({ x: action.baseX + i }) }
                : undefined;
              const ids = world.spawn(action.count, factories as any);
              applySpawn(model, ids, action.withTransform, action.baseX);
              break;
            }

            case "set": {
              const id = model.slots[action.slot];
              let threw = false;
              try {
                if (id !== undefined) {
                  if (action.useDefault) {
                    world.setComponent(id, "Transform");
                  } else {
                    world.setComponent(id, "Transform", { x: action.x });
                  }
                }
              } catch {
                threw = true;
              }
              const expectedThrow = applySet(model, action.slot, action.useDefault, action.x);
              expect(threw).toBe(expectedThrow);
              break;
            }

            case "remove": {
              const id = model.slots[action.slot];
              if (id !== undefined) {
                world.removeComponent(id, "Transform");
              }
              applyRemove(model, action.slot);
              break;
            }

            case "getMut": {
              const id = model.slots[action.slot];
              let value: { x: number } | undefined;
              if (id !== undefined) {
                value = world.getMut(id, "Transform");
                if (value && action.mutate) {
                  value.x = action.nextX;
                }
              }
              const expectedFound = applyGetMut(model, action.slot, action.mutate, action.nextX);
              expect(!!value).toBe(expectedFound);
              break;
            }

            case "destroy": {
              const id = model.slots[action.slot];
              if (id !== undefined) {
                world.destroyEntity(id);
              }
              applyDestroy(model, action.slot);
              break;
            }

            case "beginFrame":
              world.beginFrame();
              flushChanges(model);
              break;

            case "endFrame":
              world.endFrame();
              flushChanges(model);
              break;
          }

          assertWorldMatchesModel(world, model);
        }
      }),
      { numRuns: 200 },
    );
  }, 60_000);
});
