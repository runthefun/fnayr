import type { EntityId } from "./types";

const ENTITY_ID_RADIX = 1_000_000;
const DEFAULT_ENTITY_CAPACITY = ENTITY_ID_RADIX;

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
  if (!isSafeInteger(capacity) || capacity <= 0 || capacity > ENTITY_ID_RADIX) {
    throw new Error(
      `Entity capacity must be a positive safe integer in [1, ${ENTITY_ID_RADIX}]`
    );
  }
  if (!isSafeInteger(index) || index >= capacity) {
    throw new Error(`Entity index must be an integer in [0, ${capacity})`);
  }
  if (!isSafeInteger(generation)) {
    throw new Error("Entity generation must be a non-negative safe integer");
  }
  const id = generation * ENTITY_ID_RADIX + index;
  if (!Number.isSafeInteger(id)) {
    throw new Error("Entity id exceeds safe integer range");
  }
  return id;
};

/**
 * Returns the index encoded in an entity id.
 */
export const getEntityIndex = (
  entity: EntityId
): number => entity % ENTITY_ID_RADIX;

/**
 * Returns the generation encoded in an entity id.
 */
export const getEntityGeneration = (
  entity: EntityId
): number => Math.floor(entity / ENTITY_ID_RADIX);

/**
 * Manages entity lifecycle with generation-based ids.
 */
export class EntityManager {
  private readonly capacity: number;
  private readonly generations: number[] = [];
  private readonly alive: boolean[] = [];
  private readonly free = new Set<number>();
  private aliveCount = 0;

  /**
   * Creates an entity manager with an optional capacity limit.
   */
  constructor(capacity: number = DEFAULT_ENTITY_CAPACITY) {
    if (!isSafeInteger(capacity) || capacity <= 0 || capacity > ENTITY_ID_RADIX) {
      throw new Error(
        `Entity capacity must be a positive safe integer in [1, ${ENTITY_ID_RADIX}]`
      );
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
    let index: number | undefined;
    const iter = this.free.values();
    const first = iter.next();
    if (!first.done) {
      index = first.value;
      this.free.delete(index);
    }
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
    const index = getEntityIndex(entity);
    const generation = getEntityGeneration(entity);
    if (!isSafeInteger(index) || index >= this.capacity) {
      throw new Error("Entity id index is out of range");
    }

    while (this.generations.length <= index) {
      this.generations.push(0);
      this.alive.push(false);
      this.free.add(this.generations.length - 1);
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

    this.free.delete(index);

    return makeEntityId(index, this.generations[index], this.capacity);
  }

  /**
   * Destroys an entity id, invalidating stale references.
   */
  destroy(entity: EntityId): void {
    if (!this.isAlive(entity)) {
      return;
    }
    const index = getEntityIndex(entity);
    this.alive[index] = false;
    this.generations[index] += 1;
    this.free.add(index);
    this.aliveCount = Math.max(0, this.aliveCount - 1);
  }

  /**
   * Returns true if the entity id is alive.
   */
  isAlive(entity: EntityId): boolean {
    if (!isSafeInteger(entity)) {
      return false;
    }
    const index = getEntityIndex(entity);
    if (!isSafeInteger(index) || index >= this.generations.length) {
      return false;
    }
    return this.alive[index] &&
      this.generations[index] === getEntityGeneration(entity);
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

  /**
   * Resets the entity manager to its initial state, invalidating all entity IDs.
   */
  reset(): void {
    this.generations.length = 0;
    this.alive.length = 0;
    this.free.clear();
    this.aliveCount = 0;
  }

  /**
   * Iterates all alive entity ids via callback (no generator allocation).
   */
  forEachEntity(callback: (entity: EntityId) => void): void {
    for (let index = 0; index < this.alive.length; index += 1) {
      if (this.alive[index]) {
        callback(makeEntityId(index, this.generations[index], this.capacity));
      }
    }
  }
}
