import type { SchemaLike, SchemaValue } from "../schema";

/**
 * Opaque entity handle that encodes an index and generation for stale-reference safety.
 */
export type EntityId = number;

/**
 * Schema definition for a component.
 */
export type ComponentSchema = SchemaLike;

/**
 * Registry mapping component names to their schemas.
 */
export type ComponentRegistry = Record<string, ComponentSchema>;

/**
 * Registry mapping resource names to their schemas.
 */
export type ResourceRegistry = Record<string, SchemaLike>;

/**
 * Resource type name within a registry.
 */
export type ResourceType<Res extends ResourceRegistry = ResourceRegistry> = Extract<
  keyof Res,
  string
>;

/**
 * Runtime data shape for a resource schema.
 */
export type ResourceData<
  Res extends ResourceRegistry,
  K extends ResourceType<Res>,
> = SchemaValue<Res[K]>;

/**
 * Component type name within a registry.
 */
export type ComponentType<R extends ComponentRegistry = ComponentRegistry> = Extract<
  keyof R,
  string
>;

/**
 * Runtime data shape for a component schema.
 */
export type ComponentData<
  R extends ComponentRegistry,
  K extends ComponentType<R>,
> = SchemaValue<R[K]>;

/**
 * Store interface for components keyed by entity.
 */
export interface ComponentStore<T> {
  /** Number of components currently stored. */
  readonly size: number;
  /** Returns true if a component exists for the entity. */
  has(entity: EntityId): boolean;
  /** Returns the component for the entity, if present. */
  get(entity: EntityId): T | undefined;
  /** Adds or replaces the component for the entity. */
  set(entity: EntityId, value: T): void;
  /** Removes the component for the entity, returning true if it existed. */
  remove(entity: EntityId): boolean;
  /** Iterates entity-component pairs. */
  entries(): IterableIterator<[EntityId, T]>;
  /** Calls callback for each entity-component pair (no generator overhead). */
  forEachEntry(callback: (entity: EntityId, value: T) => void): void;
  /** Dense entity list in iteration order (live backing array — do not mutate). */
  entities(): readonly EntityId[];
  /** Dense component list in iteration order (live backing array — do not mutate). */
  values(): readonly T[];
  /** Clears all stored components. */
  clear(): void;
}

/**
 * Query options for include/exclude component sets.
 */
export type QueryOptions<R extends ComponentRegistry> = {
  /** Components that must NOT be present on matched entities. */
  exclude?: readonly ComponentType<R>[];
};

/**
 * Query result for a set of included component types.
 */
export type QueryResult<
  R extends ComponentRegistry,
  Include extends readonly ComponentType<R>[],
> = {
  /** Matched entity. */
  entity: EntityId;
  /** Component data keyed by included component names. */
  components: { [K in Include[number]]: ComponentData<R, K> };
};

/**
 * Iterable query over entities with the required component set.
 */
export interface Query<
  R extends ComponentRegistry,
  Include extends readonly ComponentType<R>[],
> extends Iterable<QueryResult<R, Include>> {
  /** Included component names. */
  readonly include: Include;
  /** Excluded component names. */
  readonly exclude: readonly ComponentType<R>[];
}

/**
 * World interface combining entities and component storage.
 */
export interface World<R extends ComponentRegistry, Res extends ResourceRegistry = {}> {
  /** Component registry used by the world. */
  readonly registry: R;
  /** Creates and returns a new entity. */
  createEntity(): EntityId;
  /** Destroys an entity and removes all of its components. */
  destroyEntity(entity: EntityId): void;
  /** Returns true if the entity is alive. */
  isAlive(entity: EntityId): boolean;
  /** Iterates over all alive entities. */
  entities(): Iterable<EntityId>;
  /** Adds or replaces a component on the entity. */
  addComponent<K extends ComponentType<R>>(
    entity: EntityId,
    type: K,
    data?: ComponentData<R, K>
  ): void;
  /** Removes a component from the entity. */
  removeComponent<K extends ComponentType<R>>(entity: EntityId, type: K): void;
  /** Returns a component instance for the entity, if present. */
  getComponent<K extends ComponentType<R>>(
    entity: EntityId,
    type: K
  ): ComponentData<R, K> | undefined;
  /** Returns the component for in-place mutation and marks it as updated in change tracking. */
  getMut<K extends ComponentType<R>>(
    entity: EntityId,
    type: K
  ): ComponentData<R, K> | undefined;
  /** Returns true if the entity has the component. */
  hasComponent<K extends ComponentType<R>>(entity: EntityId, type: K): boolean;
  /** Creates a query for entities that include the given components. */
  query<Include extends readonly ComponentType<R>[]>(
    include: Include,
    options?: QueryOptions<R>
  ): Query<R, Include>;
  /** Clears tracked changes at the start of a frame. */
  beginFrame(): void;
  /** Clears tracked changes at the end of a frame. */
  endFrame(): void;
  /** Clears all tracked component changes. */
  flushChanges(): void;
  /** Returns entities that added the component during the current frame. */
  getAdded<K extends ComponentType<R>>(type: K): ReadonlySet<EntityId>;
  /** Returns entities that removed the component during the current frame. */
  getRemoved<K extends ComponentType<R>>(type: K): ReadonlySet<EntityId>;
  /** Returns entities that updated the component during the current frame. */
  getUpdated<K extends ComponentType<R>>(type: K): ReadonlySet<EntityId>;
  /** Iterates all alive entities via callback (no generator allocation). */
  forEachEntity(callback: (entity: EntityId) => void): void;
  /** Sets a resource value. */
  setResource<K extends ResourceType<Res>>(type: K, data: ResourceData<Res, K>): void;
  /** Returns a resource value, or undefined if not set. */
  getResource<K extends ResourceType<Res>>(type: K): ResourceData<Res, K> | undefined;
  /** Returns true if the resource has been set. */
  hasResource<K extends ResourceType<Res>>(type: K): boolean;
  /** Number of alive entities. */
  readonly entityCount: number;
  /** Number of entities that have the given component. */
  componentCount<K extends ComponentType<R>>(type: K): number;
  /** Returns a snapshot of entity and per-component counts. */
  stats(): { entities: number; components: Record<string, number> };
  /** Destroys all entities (firing destroy listeners) and resets the world to an empty state. */
  clear(): void;
}
