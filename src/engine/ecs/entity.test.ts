import { describe, expect, it } from "vitest";
import {
  EntityManager,
  getEntityGeneration,
  getEntityIndex,
  makeEntityId,
} from "./entity";

describe("EntityManager", () => {
  it("creates unique ids", () => {
    const manager = new EntityManager();
    const first = manager.create();
    const second = manager.create();

    expect(first).not.toBe(second);
  });

  it("marks destroyed ids as not alive", () => {
    const manager = new EntityManager();
    const entity = manager.create();

    expect(manager.isAlive(entity)).toBe(true);

    manager.destroy(entity);

    expect(manager.isAlive(entity)).toBe(false);
  });

  it("reuses indices with incremented generations", () => {
    const manager = new EntityManager();
    const first = manager.create();
    manager.destroy(first);
    const second = manager.create();

    expect(getEntityIndex(second)).toBe(getEntityIndex(first));
    expect(getEntityGeneration(second)).toBe(getEntityGeneration(first) + 1);
    expect(manager.isAlive(first)).toBe(false);
    expect(manager.isAlive(second)).toBe(true);
  });

  it("decodes ids consistently with custom manager capacities", () => {
    const manager = new EntityManager(3);
    const first = manager.create();
    manager.destroy(first);
    const second = manager.create();

    expect(getEntityIndex(second)).toBe(0);
    expect(getEntityGeneration(second)).toBe(1);
    expect(manager.isAlive(second)).toBe(true);
  });

  it("reserves 100 entities by ID and verifies they are all alive with correct IDs", () => {
    const manager = new EntityManager();
    const ids: number[] = [];

    for (let i = 0; i < 100; i++) {
      const entity = makeEntityId(i, 0);
      const reserved = manager.reserve(entity);
      ids.push(reserved);
    }

    expect(manager.size).toBe(100);

    for (let i = 0; i < 100; i++) {
      expect(manager.isAlive(ids[i])).toBe(true);
      expect(getEntityIndex(ids[i])).toBe(i);
      expect(getEntityGeneration(ids[i])).toBe(0);
    }
  });

  it("forEachEntity iterates alive entities without generator allocation", () => {
    const manager = new EntityManager();
    const e1 = manager.create();
    const e2 = manager.create();
    const e3 = manager.create();
    manager.destroy(e2);

    const collected: number[] = [];
    manager.forEachEntity((entity) => collected.push(entity));

    expect(collected).toHaveLength(2);
    expect(collected).toContain(e1);
    expect(collected).not.toContain(e2);
    expect(collected).toContain(e3);
  });
});
