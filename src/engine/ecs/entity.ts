import type { EntityId } from "./types";

const DEFAULT_ENTITY_CAPACITY = 1_000_000;

const isSafeInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && Number.isSafeInteger(value);

/**
 * Returns the encoded entity id for an index and generation.
 */
export const makeEntityId = (
  index: number,
  generation: number,
  capacity: number = DEFAULT_ENTITY_CAPACITY
): EntityId => {
  if (!isSafeInteger(index) || index >= capacity) {
    throw new Error(`Entity index must be an integer in [0, ${capacity})`);
  }
  if (!isSafeInteger(generation)) {
    throw new Error("Entity generation must be a non-negative safe integer");
  }
  const id = generation * capacity + index;
  if (!Number.isSafeInteger(id)) {
    throw new Error("Entity id exceeds safe integer range");
  }
  return id;
};

/**
 * Returns the index encoded in an entity id.
 */
export const getEntityIndex = (
  entity: EntityId,
  capacity: number = DEFAULT_ENTITY_CAPACITY
): number => entity % capacity;

/**
 * Returns the generation encoded in an entity id.
 */
export const getEntityGeneration = (
  entity: EntityId,
  capacity: number = DEFAULT_ENTITY_CAPACITY
): number => Math.floor(entity / capacity);

/**
 * Manages entity lifecycle with generation-based ids.
 */
export class EntityManager {
  private readonly capacity: number;
  private readonly generations: number[] = [];
  private readonly alive: boolean[] = [];
  private readonly free: number[] = [];
  private aliveCount = 0;

  /**
   * Creates an entity manager with an optional capacity limit.
   */
  constructor(capacity: number = DEFAULT_ENTITY_CAPACITY) {
    if (!isSafeInteger(capacity) || capacity <= 0) {
      throw new Error("Entity capacity must be a positive safe integer");
    }
    this.capacity = capacity;
  }

  /**
   * Returns the number of alive entities.
   */
  get size(): number {
    return this.aliveCount;
  }

  /**
   * Creates a new entity id.
   */
  create(): EntityId {
    let index = this.free.pop();
    if (index === undefined) {
      index = this.generations.length;
      if (index >= this.capacity) {
        throw new Error("Entity capacity reached");
      }
      this.generations.push(0);
      this.alive.push(true);
    } else {
      this.alive[index] = true;
    }
    this.aliveCount += 1;
    return makeEntityId(index, this.generations[index], this.capacity);
  }

  /**
   * Reserves a specific entity id for loading or editor workflows.
   */
  reserve(entity: EntityId): EntityId {
    if (!isSafeInteger(entity)) {
      throw new Error("Entity id must be a non-negative safe integer");
    }
    const index = getEntityIndex(entity, this.capacity);
    const generation = getEntityGeneration(entity, this.capacity);
    if (!isSafeInteger(index) || index >= this.capacity) {
      throw new Error("Entity id index is out of range");
    }

    while (this.generations.length <= index) {
      this.generations.push(0);
      this.alive.push(false);
      this.free.push(this.generations.length - 1);
    }

    const currentGeneration = this.generations[index];
    if (this.alive[index]) {
      throw new Error("Entity id is already in use");
    }
    if (generation < currentGeneration) {
      throw new Error("Entity id is stale");
    }

    if (generation > currentGeneration) {
      this.generations[index] = generation;
    }
    this.alive[index] = true;
    this.aliveCount += 1;

    const freeIndex = this.free.indexOf(index);
    if (freeIndex !== -1) {
      this.free.splice(freeIndex, 1);
    }

    return makeEntityId(index, this.generations[index], this.capacity);
  }

  /**
   * Destroys an entity id, invalidating stale references.
   */
  destroy(entity: EntityId): void {
    if (!this.isAlive(entity)) {
      return;
    }
    const index = getEntityIndex(entity, this.capacity);
    this.alive[index] = false;
    this.generations[index] += 1;
    this.free.push(index);
    this.aliveCount = Math.max(0, this.aliveCount - 1);
  }

  /**
   * Returns true if the entity id is alive.
   */
  isAlive(entity: EntityId): boolean {
    if (!isSafeInteger(entity)) {
      return false;
    }
    const index = getEntityIndex(entity, this.capacity);
    if (!isSafeInteger(index) || index >= this.generations.length) {
      return false;
    }
    return this.alive[index] &&
      this.generations[index] === getEntityGeneration(entity, this.capacity);
  }

  /**
   * Iterates all alive entity ids.
   */
  *entities(): Iterable<EntityId> {
    for (let index = 0; index < this.alive.length; index += 1) {
      if (this.alive[index]) {
        yield makeEntityId(index, this.generations[index], this.capacity);
      }
    }
  }
}
