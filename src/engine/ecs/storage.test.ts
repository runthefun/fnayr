import { describe, expect, it } from "vitest";
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
});
