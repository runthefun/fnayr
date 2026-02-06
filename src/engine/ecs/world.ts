import type {
  CachedQuery,
  ComponentData,
  ComponentRegistry,
  ComponentType,
  EntityId,
  EventData,
  EventType,
  Query,
  QueryOptions,
  ResourceData,
  ResourceRegistry,
  ResourceType,
  World,
} from "./types";
import type { EventRegistry } from "./events";
import { EventBus } from "./events";
import { EntityManager } from "./entity";
import { SparseSetStore } from "./storage";
import { getDefault } from "../schema";

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/**
 * Internal cached query implementation that incrementally tracks matched entities.
 */
class CachedQueryImpl<
  R extends ComponentRegistry,
  Include extends readonly ComponentType<R>[],
> implements CachedQuery<R, Include>
{
  readonly include: Include;
  readonly exclude: readonly ComponentType<R>[];
  private readonly includeSet: Set<string>;
  private readonly excludeSet: Set<string>;
  readonly matched = new Set<EntityId>();
  private readonly world: EcsWorld<R, any>;

  constructor(
    world: EcsWorld<R, any>,
    include: Include,
    exclude: readonly ComponentType<R>[]
  ) {
    this.world = world;
    this.include = include;
    this.exclude = exclude;
    this.includeSet = new Set(include as readonly string[]);
    this.excludeSet = new Set(exclude as readonly string[]);

    // Build initial matched set by scanning existing entities
    this.buildInitialSet();
  }

  get size(): number {
    return this.matched.size;
  }

  *[Symbol.iterator](): IterableIterator<{
    entity: EntityId;
    components: { [K in Include[number]]: ComponentData<R, K> };
  }> {
    const snapshot = Array.from(this.matched);
    for (const entity of snapshot) {
      if (!this.matched.has(entity)) {
        continue;
      }
      const components = {} as {
        [K in Include[number]]: ComponentData<R, K>;
      };
      for (const type of this.include) {
        components[type] = this.world.getComponent(entity, type)!;
      }
      yield { entity, components };
    }
  }

  /** Check if a component type is relevant to this query. */
  isRelevantType(type: string): boolean {
    return this.includeSet.has(type) || this.excludeSet.has(type);
  }

  /** Called when a component is added to an entity. Re-evaluate match. */
  onComponentAdded(entity: EntityId, type: string): void {
    if (!this.isRelevantType(type)) return;

    if (this.excludeSet.has(type)) {
      // An excluded component was added — remove from matched
      this.matched.delete(entity);
      return;
    }

    // An included component was added — check if entity now fully matches
    if (this.entityMatches(entity)) {
      this.matched.add(entity);
    }
  }

  /** Called when a component is removed from an entity. Re-evaluate match. */
  onComponentRemoved(entity: EntityId, type: string): void {
    if (!this.isRelevantType(type)) return;

    if (this.includeSet.has(type)) {
      // A required component was removed — entity can't match
      this.matched.delete(entity);
      return;
    }

    // An excluded component was removed — check if entity now matches
    if (this.entityMatches(entity)) {
      this.matched.add(entity);
    }
  }

  /** Called when an entity is destroyed. */
  onEntityDestroyed(entity: EntityId): void {
    this.matched.delete(entity);
  }

  private entityMatches(entity: EntityId): boolean {
    for (const type of this.include) {
      if (!this.world.hasComponent(entity, type)) {
        return false;
      }
    }
    for (const type of this.exclude) {
      if (this.world.hasComponent(entity, type)) {
        return false;
      }
    }
    return true;
  }

  private buildInitialSet(): void {
    if (this.include.length === 0) {
      // Match all entities that don't have excluded components
      this.world.forEachEntity((entity) => {
        if (this.entityMatches(entity)) {
          this.matched.add(entity);
        }
      });
      return;
    }

    // Use the on-demand query to build the initial set
    const q = this.world.query(this.include, {
      exclude: this.exclude.length > 0 ? this.exclude : undefined,
    });
    for (const { entity } of q) {
      this.matched.add(entity);
    }
  }
}

/**
 * Runtime ECS world composed of entities and component stores.
 */
export class EcsWorld<
  R extends ComponentRegistry,
  Res extends ResourceRegistry = {},
  E extends EventRegistry = {},
> implements World<R, Res, E>
{
  readonly registry: R;
  readonly resourceRegistry: Res;
  private readonly entityManager: EntityManager;
  private readonly stores = new Map<ComponentType<R>, SparseSetStore<unknown>>();
  private readonly destroyListeners = new Set<(entity: number) => void>();
  private readonly changes = new Map<
    ComponentType<R>,
    { added: Set<number>; removed: Set<number>; updated: Set<number> }
  >();
  private readonly resources = new Map<string, unknown>();
  private readonly cachedQueries: CachedQueryImpl<R, readonly ComponentType<R>[]>[] = [];
  private readonly eventBus: EventBus<E> | undefined;

  /**
   * Creates a new ECS world for the given registry.
   */
  constructor(
    registry: R,
    options: { capacity?: number; resources?: Res; events?: E } = {}
  ) {
    this.registry = registry;
    this.resourceRegistry = (options.resources ?? {}) as Res;
    this.entityManager = new EntityManager(options.capacity);
    if (options.events) {
      this.eventBus = new EventBus(options.events);
    }
  }

  /**
   * Creates and returns a new entity.
   */
  createEntity(): number {
    return this.entityManager.create();
  }

  /**
   * Reserves a specific entity id for loaded data.
   */
  createEntityWithId(entity: number): number {
    return this.entityManager.reserve(entity);
  }

  /**
   * Destroys an entity and removes all attached components.
   * Listeners fire first while the entity is still alive and components are accessible.
   */
  destroyEntity(entity: number): void {
    if (!this.entityManager.isAlive(entity)) {
      return;
    }
    for (const listener of this.destroyListeners) {
      listener(entity);
    }
    for (const [type, store] of this.stores) {
      if (store.remove(entity)) {
        this.recordRemoved(type, entity);
      }
    }
    this.notifyCachedQueriesDestroyed(entity);
    this.entityManager.destroy(entity);
  }

  /**
   * Returns true if the entity is alive.
   */
  isAlive(entity: number): boolean {
    return this.entityManager.isAlive(entity);
  }

  /**
   * Iterates all alive entities.
   */
  entities(): Iterable<number> {
    return this.entityManager.entities();
  }

  /**
   * Adds or replaces a component on the entity.
   */
  addComponent<K extends ComponentType<R>>(
    entity: number,
    type: K,
    data?: ComponentData<R, K>
  ): void {
    this.assertAlive(entity, "add component");
    const schema = this.registry[type];
    let value: unknown = data;
    if (schema.type === "tag") {
      value = true;
    } else if (data === undefined) {
      value = getDefault(schema);
    }
    const store = this.getStore(type);
    const existed = store.has(entity);
    store.set(entity, value as ComponentData<R, K>);
    if (existed) {
      this.recordUpdated(type, entity);
    } else {
      this.recordAdded(type, entity);
      this.notifyCachedQueriesAdded(entity, type);
    }
  }

  /**
   * Removes a component from the entity.
   */
  removeComponent<K extends ComponentType<R>>(entity: number, type: K): void {
    if (!this.entityManager.isAlive(entity)) {
      return;
    }
    const store = this.stores.get(type);
    if (!store) {
      return;
    }
    if (store.remove(entity)) {
      this.recordRemoved(type, entity);
      this.notifyCachedQueriesRemoved(entity, type);
    }
  }

  /**
   * Returns a component instance for the entity, if present.
   */
  getComponent<K extends ComponentType<R>>(
    entity: number,
    type: K
  ): ComponentData<R, K> | undefined {
    if (!this.entityManager.isAlive(entity)) {
      return undefined;
    }
    const store = this.stores.get(type);
    if (!store) {
      return undefined;
    }
    return store.get(entity) as ComponentData<R, K> | undefined;
  }

  /**
   * Returns the component for in-place mutation and marks it as updated in change tracking.
   */
  getMut<K extends ComponentType<R>>(
    entity: number,
    type: K
  ): ComponentData<R, K> | undefined {
    if (!this.entityManager.isAlive(entity)) {
      return undefined;
    }
    const store = this.stores.get(type);
    if (!store) {
      return undefined;
    }
    const value = store.get(entity) as ComponentData<R, K> | undefined;
    if (value !== undefined) {
      this.recordUpdated(type, entity);
    }
    return value;
  }

  /**
   * Returns true if the entity has the component.
   */
  hasComponent<K extends ComponentType<R>>(entity: number, type: K): boolean {
    if (!this.entityManager.isAlive(entity)) {
      return false;
    }
    const store = this.stores.get(type);
    return store ? store.has(entity) : false;
  }

  /**
   * Creates a query for entities that include the given components.
   */
  query<Include extends readonly ComponentType<R>[]>(
    include: Include,
    options?: QueryOptions<R>
  ): Query<R, Include> {
    const exclude = options?.exclude ?? [];
    const includeTypes = [...include];
    const excludeTypes = [...exclude];

    for (const type of includeTypes) {
      this.assertRegistered(type);
    }
    for (const type of excludeTypes) {
      this.assertRegistered(type);
    }

    const world = this;

    return {
      include,
      exclude: excludeTypes,
      *[Symbol.iterator](): IterableIterator<{
        entity: number;
        components: { [K in Include[number]]: ComponentData<R, K> };
      }> {
        if (includeTypes.length === 0) {
          const entities = Array.from(world.entities());
          for (const entity of entities) {
            let blocked = false;
            for (const excluded of excludeTypes) {
              const store = world.stores.get(excluded);
              if (store?.has(entity)) {
                blocked = true;
                break;
              }
            }
            if (!blocked) {
              yield {
                entity,
                components: {} as {
                  [K in Include[number]]: ComponentData<R, K>;
                },
              };
            }
          }
          return;
        }

        const includeStores = includeTypes.map((type) => world.stores.get(type));
        if (includeStores.some((store) => !store)) {
          return;
        }

        let baseStoreIndex = 0;
        for (let index = 1; index < includeStores.length; index += 1) {
          if (includeStores[index]!.size < includeStores[baseStoreIndex]!.size) {
            baseStoreIndex = index;
          }
        }

        const baseStore = includeStores[baseStoreIndex]!;
        const baseEntities = baseStore.entities().slice();

        for (const entity of baseEntities) {
          if (!baseStore.has(entity)) {
            continue;
          }

          let matches = true;
          for (let index = 0; index < includeStores.length; index += 1) {
            if (index === baseStoreIndex) {
              continue;
            }
            if (!includeStores[index]!.has(entity)) {
              matches = false;
              break;
            }
          }
          if (!matches) {
            continue;
          }

          for (const excluded of excludeTypes) {
            const store = world.stores.get(excluded);
            if (store?.has(entity)) {
              matches = false;
              break;
            }
          }
          if (!matches) {
            continue;
          }

          const components = {} as {
            [K in Include[number]]: ComponentData<R, K>;
          };
          for (let index = 0; index < includeTypes.length; index += 1) {
            const type = includeTypes[index];
            components[type] = includeStores[index]!.get(
              entity
            ) as ComponentData<R, Include[number]>;
          }
          yield { entity, components };
        }
      },
    };
  }

  /**
   * Creates a cached query that incrementally tracks matched entities.
   */
  createQuery<Include extends readonly ComponentType<R>[]>(
    include: Include,
    options?: QueryOptions<R>
  ): CachedQuery<R, Include> {
    const exclude = options?.exclude ?? [];

    for (const type of include) {
      this.assertRegistered(type);
    }
    for (const type of exclude) {
      this.assertRegistered(type);
    }

    const cached = new CachedQueryImpl<R, Include>(this, include, exclude);
    this.cachedQueries.push(
      cached as unknown as CachedQueryImpl<R, readonly ComponentType<R>[]>
    );
    return cached;
  }

  /**
   * Clears tracked changes at the start of a frame.
   * Also clears event buffers from the previous frame.
   */
  beginFrame(): void {
    this.flushChanges();
    this.eventBus?.flush();
  }

  /**
   * Clears tracked changes at the end of a frame.
   */
  endFrame(): void {
    this.flushChanges();
  }

  /**
   * Clears all tracked component changes.
   */
  flushChanges(): void {
    for (const changeSet of this.changes.values()) {
      changeSet.added.clear();
      changeSet.removed.clear();
      changeSet.updated.clear();
    }
  }

  /**
   * Returns entities that added the component during the current frame.
   */
  getAdded<K extends ComponentType<R>>(type: K): ReadonlySet<number> {
    this.assertRegistered(type);
    return this.getChangeSet(type).added;
  }

  /**
   * Returns entities that removed the component during the current frame.
   */
  getRemoved<K extends ComponentType<R>>(type: K): ReadonlySet<number> {
    this.assertRegistered(type);
    return this.getChangeSet(type).removed;
  }

  /**
   * Returns entities that updated the component during the current frame.
   */
  getUpdated<K extends ComponentType<R>>(type: K): ReadonlySet<number> {
    this.assertRegistered(type);
    return this.getChangeSet(type).updated;
  }

  /**
   * Iterates all alive entities via callback (no generator allocation).
   */
  forEachEntity(callback: (entity: number) => void): void {
    this.entityManager.forEachEntity(callback);
  }

  /**
   * Sets a resource value.
   */
  setResource<K extends ResourceType<Res>>(
    type: K,
    data: ResourceData<Res, K>
  ): void {
    this.assertResourceRegistered(type);
    this.resources.set(type, data);
  }

  /**
   * Returns a resource value, or undefined if not set.
   */
  getResource<K extends ResourceType<Res>>(
    type: K
  ): ResourceData<Res, K> | undefined {
    this.assertResourceRegistered(type);
    return this.resources.get(type) as ResourceData<Res, K> | undefined;
  }

  /**
   * Returns true if the resource has been set.
   */
  hasResource<K extends ResourceType<Res>>(type: K): boolean {
    this.assertResourceRegistered(type);
    return this.resources.has(type);
  }

  /**
   * Emits an event, appending it to the buffer for the current frame.
   */
  emit<K extends EventType<E>>(type: K, data: EventData<E, K>): void {
    if (!this.eventBus) {
      throw new Error("No event registry configured on this world");
    }
    this.eventBus.emit(type, data);
  }

  /**
   * Returns all events of the given type emitted so far this frame.
   */
  read<K extends EventType<E>>(type: K): readonly EventData<E, K>[] {
    if (!this.eventBus) {
      throw new Error("No event registry configured on this world");
    }
    return this.eventBus.read(type);
  }

  /**
   * Number of alive entities.
   */
  get entityCount(): number {
    return this.entityManager.size;
  }

  /**
   * Number of entities that have the given component.
   */
  componentCount<K extends ComponentType<R>>(type: K): number {
    this.assertRegistered(type);
    const store = this.stores.get(type);
    return store ? store.size : 0;
  }

  /**
   * Returns a snapshot of entity and per-component counts.
   */
  stats(): { entities: number; components: Record<string, number> } {
    const components: Record<string, number> = {};
    for (const type of Object.keys(this.registry)) {
      const store = this.stores.get(type as ComponentType<R>);
      components[type] = store ? store.size : 0;
    }
    return { entities: this.entityManager.size, components };
  }

  /**
   * Destroys all entities (firing destroy listeners) and resets the world to an empty state.
   */
  clear(): void {
    // Collect alive entities first (snapshot to avoid mutation during iteration)
    const alive: number[] = [];
    this.entityManager.forEachEntity((entity) => alive.push(entity));

    // Fire destroy listeners for each alive entity while components are still accessible
    for (const entity of alive) {
      for (const listener of this.destroyListeners) {
        listener(entity);
      }
    }

    // Clear all component stores
    for (const store of this.stores.values()) {
      store.clear();
    }

    // Clear all cached query matched sets
    for (const cq of this.cachedQueries) {
      cq.matched.clear();
    }

    // Reset entity manager
    this.entityManager.reset();

    // Flush all change tracking
    this.flushChanges();
  }

  /**
   * Registers a callback invoked after an entity is destroyed.
   */
  onEntityDestroyed(listener: (entity: number) => void): () => void {
    this.destroyListeners.add(listener);
    return () => {
      this.destroyListeners.delete(listener);
    };
  }

  private assertAlive(entity: number, action: string): void {
    if (!this.entityManager.isAlive(entity)) {
      throw new Error(`Cannot ${action}: entity ${entity} is not alive`);
    }
  }

  private assertRegistered(type: ComponentType<R>): void {
    if (!hasOwn(this.registry, type)) {
      throw new Error(`Unknown component type: ${type}`);
    }
  }

  private assertResourceRegistered(type: ResourceType<Res>): void {
    if (!hasOwn(this.resourceRegistry, type)) {
      throw new Error(`Unknown resource type: ${type}`);
    }
  }

  private getChangeSet(type: ComponentType<R>): {
    added: Set<number>;
    removed: Set<number>;
    updated: Set<number>;
  } {
    let changeSet = this.changes.get(type);
    if (!changeSet) {
      changeSet = {
        added: new Set<number>(),
        removed: new Set<number>(),
        updated: new Set<number>(),
      };
      this.changes.set(type, changeSet);
    }
    return changeSet;
  }

  private recordAdded(type: ComponentType<R>, entity: number): void {
    const changeSet = this.getChangeSet(type);
    changeSet.removed.delete(entity);
    changeSet.updated.delete(entity);
    changeSet.added.add(entity);
  }

  private recordRemoved(type: ComponentType<R>, entity: number): void {
    const changeSet = this.getChangeSet(type);
    if (changeSet.added.delete(entity)) {
      changeSet.updated.delete(entity);
      return;
    }
    changeSet.updated.delete(entity);
    changeSet.removed.add(entity);
  }

  private recordUpdated(type: ComponentType<R>, entity: number): void {
    const changeSet = this.getChangeSet(type);
    if (changeSet.added.has(entity)) {
      return;
    }
    changeSet.updated.add(entity);
  }

  private notifyCachedQueriesAdded(entity: EntityId, type: ComponentType<R>): void {
    for (const cq of this.cachedQueries) {
      cq.onComponentAdded(entity, type);
    }
  }

  private notifyCachedQueriesRemoved(entity: EntityId, type: ComponentType<R>): void {
    for (const cq of this.cachedQueries) {
      cq.onComponentRemoved(entity, type);
    }
  }

  private notifyCachedQueriesDestroyed(entity: EntityId): void {
    for (const cq of this.cachedQueries) {
      cq.onEntityDestroyed(entity);
    }
  }

  private getStore<K extends ComponentType<R>>(
    type: K
  ): SparseSetStore<ComponentData<R, K>> {
    this.assertRegistered(type);
    let store = this.stores.get(type);
    if (!store) {
      store = new SparseSetStore<ComponentData<R, K>>();
      this.stores.set(type, store);
    }
    return store as SparseSetStore<ComponentData<R, K>>;
  }
}

/**
 * Creates a new ECS world for a registry.
 */
export function createWorld<R extends ComponentRegistry>(
  registry: R,
  options?: { capacity?: number }
): EcsWorld<R>;
export function createWorld<R extends ComponentRegistry, Res extends ResourceRegistry>(
  registry: R,
  options: { capacity?: number; resources: Res }
): EcsWorld<R, Res>;
export function createWorld<
  R extends ComponentRegistry,
  Res extends ResourceRegistry,
  E extends EventRegistry,
>(
  registry: R,
  options: { capacity?: number; resources: Res; events: E }
): EcsWorld<R, Res, E>;
export function createWorld<
  R extends ComponentRegistry,
  Res extends ResourceRegistry,
  E extends EventRegistry,
>(
  registry: R,
  options: { capacity?: number; resources?: Res; events?: E } = {}
): EcsWorld<R, Res, E> {
  return new EcsWorld(registry, options);
}
