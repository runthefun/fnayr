import { describe, expect, it } from "vitest";
import {
  EntityManager,
  getEntityGeneration,
  getEntityIndex,
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
});
