import { describe, expect, it } from "vitest";
import { makeEntityId } from "./entity";
import { SparseSetStore } from "./storage";

describe("SparseSetStore", () => {
  it("adds, gets, and checks components", () => {
    const store = new SparseSetStore<string>();
    const entity = 10;

    expect(store.has(entity)).toBe(false);
    expect(store.get(entity)).toBeUndefined();

    store.set(entity, "hello");

    expect(store.has(entity)).toBe(true);
    expect(store.get(entity)).toBe("hello");
  });

  it("removes components and compacts dense arrays", () => {
    const store = new SparseSetStore<number>();
    store.set(1, 10);
    store.set(2, 20);
    store.set(3, 30);

    expect(store.remove(2)).toBe(true);
    expect(store.has(2)).toBe(false);
    expect(store.size).toBe(2);

    const entities = store.entities();
    const values = store.values();

    expect(entities).toHaveLength(2);
    expect(values).toHaveLength(2);

    const pairs = Array.from(store.entries());
    expect(pairs).toContainEqual([1, 10]);
    expect(pairs).toContainEqual([3, 30]);
  });

  it("iterates entities and data in sync", () => {
    const store = new SparseSetStore<string>();
    store.set(5, "alpha");
    store.set(8, "beta");

    const entries = Array.from(store.entries());

    expect(entries).toEqual([
      [5, "alpha"],
      [8, "beta"],
    ]);
  });

  it("returns live backing arrays from entities() and values()", () => {
    const store = new SparseSetStore<string>();
    store.set(5, "alpha");
    store.set(8, "beta");

    const entities = store.entities();
    const values = store.values();

    expect(entities).toEqual([5, 8]);
    expect(values).toEqual(["alpha", "beta"]);

    // The returned arrays reflect subsequent mutations (live view).
    store.set(9, "gamma");
    expect(entities).toEqual([5, 8, 9]);
    expect(values).toEqual(["alpha", "beta", "gamma"]);
  });

  it("forEachEntry iterates all pairs without generator overhead", () => {
    const store = new SparseSetStore<string>();
    store.set(5, "alpha");
    store.set(8, "beta");

    const pairs: [number, string][] = [];
    store.forEachEntry((entity, value) => {
      pairs.push([entity, value]);
    });

    expect(pairs).toEqual([
      [5, "alpha"],
      [8, "beta"],
    ]);
  });

  it("stale entity IDs (same index, different generation) do not collide", () => {
    const store = new SparseSetStore<string>();
    // gen0 at index 3
    const entityGen0 = makeEntityId(3, 0);
    // gen1 at index 3 (same index, next generation)
    const entityGen1 = makeEntityId(3, 1);

    store.set(entityGen0, "gen0-value");
    expect(store.has(entityGen0)).toBe(true);
    expect(store.get(entityGen0)).toBe("gen0-value");

    // Remove gen0
    store.remove(entityGen0);
    expect(store.has(entityGen0)).toBe(false);

    // Add gen1 at the same index
    store.set(entityGen1, "gen1-value");
    expect(store.has(entityGen1)).toBe(true);
    expect(store.get(entityGen1)).toBe("gen1-value");

    // gen0 must NOT match — stale reference
    expect(store.has(entityGen0)).toBe(false);
    expect(store.get(entityGen0)).toBeUndefined();
  });

  it("stale entity ID does not produce false positive without removal", () => {
    const store = new SparseSetStore<string>();
    const entityGen0 = makeEntityId(5, 0);
    const entityGen1 = makeEntityId(5, 1);

    // Store a component for gen0
    store.set(entityGen0, "old");

    // Without removing gen0, querying gen1 at the same index should not match
    expect(store.has(entityGen1)).toBe(false);
    expect(store.get(entityGen1)).toBeUndefined();

    // gen0 still works
    expect(store.has(entityGen0)).toBe(true);
    expect(store.get(entityGen0)).toBe("old");
  });
});
