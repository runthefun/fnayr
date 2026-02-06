import type {
  ComponentData,
  ComponentRegistry,
  ComponentType,
  Query,
  QueryOptions,
  ResourceData,
  ResourceRegistry,
  ResourceType,
  World,
} from "./types";
import { EntityManager } from "./entity";
import { SparseSetStore } from "./storage";
import { getDefault } from "../schema";

const hasOwn = (value: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

/**
 * Runtime ECS world composed of entities and component stores.
 */
export class EcsWorld<R extends ComponentRegistry, Res extends ResourceRegistry = {}>
  implements World<R, Res>
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

  /**
   * Creates a new ECS world for the given registry.
   */
  constructor(
    registry: R,
    options: { capacity?: number; resources?: Res } = {}
  ) {
    this.registry = registry;
    this.resourceRegistry = (options.resources ?? {}) as Res;
    this.entityManager = new EntityManager(options.capacity);
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
   * Clears tracked changes at the start of a frame.
   */
  beginFrame(): void {
    this.flushChanges();
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
export function createWorld<R extends ComponentRegistry, Res extends ResourceRegistry>(
  registry: R,
  options: { capacity?: number; resources?: Res } = {}
): EcsWorld<R, Res> {
  return new EcsWorld(registry, options);
}
