import { getEntityIndex } from "./entity";
import type { ComponentStore, EntityId } from "./types";

/**
 * Sparse-set component store with dense iteration order.
 * Uses a flat array indexed by entity index for O(1) lookup without hash overhead.
 */
export class SparseSetStore<T> implements ComponentStore<T> {
  private readonly denseEntities: EntityId[] = [];
  private readonly denseValues: T[] = [];
  private readonly sparse: (number | undefined)[] = [];

  /**
   * Returns the number of stored components.
   */
  get size(): number {
    return this.denseEntities.length;
  }

  /**
   * Returns true if the entity has a stored component.
   */
  has(entity: EntityId): boolean {
    const idx = getEntityIndex(entity);
    const densePos = this.sparse[idx];
    return densePos !== undefined && this.denseEntities[densePos] === entity;
  }

  /**
   * Returns the component for the entity, if present.
   */
  get(entity: EntityId): T | undefined {
    const idx = getEntityIndex(entity);
    const densePos = this.sparse[idx];
    if (densePos === undefined || this.denseEntities[densePos] !== entity) {
      return undefined;
    }
    return this.denseValues[densePos];
  }

  /**
   * Adds or replaces a component for the entity.
   */
  set(entity: EntityId, value: T): void {
    const idx = getEntityIndex(entity);
    const densePos = this.sparse[idx];
    if (densePos !== undefined && this.denseEntities[densePos] === entity) {
      this.denseValues[densePos] = value;
      return;
    }
    const nextIndex = this.denseEntities.length;
    this.denseEntities.push(entity);
    this.denseValues.push(value);
    this.sparse[idx] = nextIndex;
  }

  /**
   * Removes the component for the entity.
   */
  remove(entity: EntityId): boolean {
    const idx = getEntityIndex(entity);
    const densePos = this.sparse[idx];
    if (densePos === undefined || this.denseEntities[densePos] !== entity) {
      return false;
    }

    const lastIndex = this.denseEntities.length - 1;
    const lastEntity = this.denseEntities[lastIndex];
    if (densePos !== lastIndex) {
      this.denseEntities[densePos] = lastEntity;
      this.denseValues[densePos] = this.denseValues[lastIndex];
      this.sparse[getEntityIndex(lastEntity)] = densePos;
    }

    this.denseEntities.pop();
    this.denseValues.pop();
    this.sparse[idx] = undefined;
    return true;
  }

  /**
   * Iterates all entity-component pairs in dense order.
   */
  *entries(): IterableIterator<[EntityId, T]> {
    for (let index = 0; index < this.denseEntities.length; index += 1) {
      yield [this.denseEntities[index], this.denseValues[index]];
    }
  }

  /**
   * Calls callback for each entity-component pair (no generator overhead).
   */
  forEachEntry(callback: (entity: EntityId, value: T) => void): void {
    for (let index = 0; index < this.denseEntities.length; index += 1) {
      callback(this.denseEntities[index], this.denseValues[index]);
    }
  }

  /**
   * Returns the dense entity list (live backing array — do not mutate).
   */
  entities(): readonly EntityId[] {
    return this.denseEntities;
  }

  /**
   * Returns the dense component list (live backing array — do not mutate).
   */
  values(): readonly T[] {
    return this.denseValues;
  }

  /**
   * Removes all stored components.
   */
  clear(): void {
    this.denseEntities.length = 0;
    this.denseValues.length = 0;
    this.sparse.length = 0;
  }
}
