import type { ComponentStore, EntityId } from "./types";

/**
 * Sparse-set component store with dense iteration order.
 */
export class SparseSetStore<T> implements ComponentStore<T> {
  private readonly denseEntities: EntityId[] = [];
  private readonly denseValues: T[] = [];
  private readonly sparse = new Map<EntityId, number>();

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
    return this.sparse.has(entity);
  }

  /**
   * Returns the component for the entity, if present.
   */
  get(entity: EntityId): T | undefined {
    const index = this.sparse.get(entity);
    return index === undefined ? undefined : this.denseValues[index];
  }

  /**
   * Adds or replaces a component for the entity.
   */
  set(entity: EntityId, value: T): void {
    const index = this.sparse.get(entity);
    if (index === undefined) {
      const nextIndex = this.denseEntities.length;
      this.denseEntities.push(entity);
      this.denseValues.push(value);
      this.sparse.set(entity, nextIndex);
      return;
    }
    this.denseValues[index] = value;
  }

  /**
   * Removes the component for the entity.
   */
  remove(entity: EntityId): boolean {
    const index = this.sparse.get(entity);
    if (index === undefined) {
      return false;
    }

    const lastIndex = this.denseEntities.length - 1;
    const lastEntity = this.denseEntities[lastIndex];
    if (index !== lastIndex) {
      this.denseEntities[index] = lastEntity;
      this.denseValues[index] = this.denseValues[lastIndex];
      this.sparse.set(lastEntity, index);
    }

    this.denseEntities.pop();
    this.denseValues.pop();
    this.sparse.delete(entity);
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
    this.sparse.clear();
  }
}
