import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import { s } from "../schema";
import { createWorld } from "./world";
import { Hierarchy } from "./hierarchy";

const registry = {
  Transform: s.object({ x: s.number(), y: s.number() }),
  Name: s.object({ label: s.string() }),
};

const SLOT_COUNT = 8;

type Action =
  | { kind: "create"; slot: number }
  | { kind: "setParent"; childSlot: number; parentSlot: number }
  | { kind: "removeParent"; slot: number }
  | { kind: "destroy"; slot: number };

type Model = {
  alive: Set<number>;
  parentOf: Map<number, number>;
  childrenOf: Map<number, number[]>;
  knownIds: Set<number>;
  slots: Array<number | undefined>;
};

function initModel(): Model {
  return {
    alive: new Set(),
    parentOf: new Map(),
    childrenOf: new Map(),
    knownIds: new Set(),
    slots: Array.from({ length: SLOT_COUNT }, () => undefined),
  };
}

function children(model: Model, parent: number): number[] {
  return model.childrenOf.get(parent) ?? [];
}

function removeChild(model: Model, parent: number, child: number): void {
  const arr = model.childrenOf.get(parent);
  if (!arr) return;
  const idx = arr.indexOf(child);
  if (idx !== -1) arr.splice(idx, 1);
  if (arr.length === 0) model.childrenOf.delete(parent);
}

function isDescendantOfModel(model: Model, entity: number, ancestor: number): boolean {
  let current = model.parentOf.get(entity);
  while (current !== undefined) {
    if (current === ancestor) return true;
    current = model.parentOf.get(current);
  }
  return false;
}

function setParentModel(model: Model, child: number, parent: number): boolean {
  if (!model.alive.has(child)) return true;
  if (!model.alive.has(parent)) return true;
  if (child === parent) return true;
  if (isDescendantOfModel(model, parent, child)) return true;

  const oldParent = model.parentOf.get(child);
  if (oldParent !== undefined) {
    removeChild(model, oldParent, child);
  }

  model.parentOf.set(child, parent);
  const arr = children(model, parent);
  arr.push(child);
  model.childrenOf.set(parent, arr);
  return false;
}

function removeParentModel(model: Model, child: number): void {
  const parent = model.parentOf.get(child);
  if (parent === undefined) return;
  model.parentOf.delete(child);
  removeChild(model, parent, child);
}

function destroyModel(model: Model, entity: number): void {
  if (!model.alive.has(entity)) return;

  const parent = model.parentOf.get(entity);
  if (parent !== undefined) {
    model.parentOf.delete(entity);
    removeChild(model, parent, entity);
  }

  const directChildren = (model.childrenOf.get(entity) ?? []).slice();
  if (directChildren.length > 0) {
    model.childrenOf.delete(entity);
    for (const child of directChildren) {
      model.parentOf.delete(child);
      destroyModel(model, child);
    }
  }

  model.alive.delete(entity);
}

function assertHierarchyInvariants(
  world: ReturnType<typeof createWorld<typeof registry>>,
  hierarchy: Hierarchy<typeof registry>,
  model: Model,
): void {
  const realAlive = new Set(world.entities());
  expect(realAlive).toEqual(model.alive);

  for (const id of model.knownIds) {
    expect(world.isAlive(id)).toBe(model.alive.has(id));
  }

  // Parent/children shape agrees with the model.
  for (const id of model.knownIds) {
    const realParent = hierarchy.getParent(id);
    const modelParent = model.parentOf.get(id);
    expect(realParent).toBe(modelParent);

    const realChildren = [...hierarchy.getChildren(id)];
    const modelChildren = [...children(model, id)];
    expect(realChildren).toEqual(modelChildren);
    expect(new Set(realChildren).size).toBe(realChildren.length);

    if (!model.alive.has(id)) {
      expect(realParent).toBeUndefined();
      expect(realChildren).toEqual([]);
    }
  }

  // Bidirectional consistency and liveness guarantees.
  for (const [child, parent] of model.parentOf) {
    expect(model.alive.has(child)).toBe(true);
    expect(model.alive.has(parent)).toBe(true);
    expect(children(model, parent)).toContain(child);
  }
  for (const [parent, childList] of model.childrenOf) {
    expect(model.alive.has(parent)).toBe(true);
    for (const child of childList) {
      expect(model.parentOf.get(child)).toBe(parent);
      expect(model.alive.has(child)).toBe(true);
    }
  }

  // Descendant relation matches model traversal.
  const ids = [...model.knownIds];
  for (const a of ids) {
    for (const b of ids) {
      expect(hierarchy.isDescendantOf(a, b)).toBe(isDescendantOfModel(model, a, b));
    }
  }
}

const slotArb = fc.integer({ min: 0, max: SLOT_COUNT - 1 });

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ kind: fc.constant("create"), slot: slotArb }),
  fc.record({
    kind: fc.constant("setParent"),
    childSlot: slotArb,
    parentSlot: slotArb,
  }),
  fc.record({ kind: fc.constant("removeParent"), slot: slotArb }),
  fc.record({ kind: fc.constant("destroy"), slot: slotArb }),
);

describe("Hierarchy (property-based)", () => {
  it("preserves hierarchy invariants across random parent/reparent/orphan/destroy sequences", () => {
    fc.assert(
      fc.property(fc.array(actionArb, { minLength: 1, maxLength: 150 }), (actions) => {
        const world = createWorld(registry);
        const hierarchy = new Hierarchy(world);
        const model = initModel();

        assertHierarchyInvariants(world, hierarchy, model);

        for (const action of actions) {
          switch (action.kind) {
            case "create": {
              const id = world.createEntity();
              model.alive.add(id);
              model.knownIds.add(id);
              model.slots[action.slot] = id;
              break;
            }

            case "setParent": {
              const child = model.slots[action.childSlot];
              const parent = model.slots[action.parentSlot];
              if (child === undefined || parent === undefined) break;

              let threw = false;
              try {
                hierarchy.setParent(child, parent);
              } catch {
                threw = true;
              }

              const expectedThrow = setParentModel(model, child, parent);
              expect(threw).toBe(expectedThrow);
              break;
            }

            case "removeParent": {
              const child = model.slots[action.slot];
              if (child === undefined) break;
              hierarchy.removeParent(child);
              removeParentModel(model, child);
              break;
            }

            case "destroy": {
              const id = model.slots[action.slot];
              if (id === undefined) break;
              world.destroyEntity(id);
              destroyModel(model, id);
              break;
            }
          }

          assertHierarchyInvariants(world, hierarchy, model);
        }
      }),
      { numRuns: 250 },
    );
  }, 60_000);
});
