# ECS Refactor Plan

Refactor roadmap for the ECS module (`src/engine/ecs/`) to serve as the foundation of a 3D web game engine built on Three.js WebGPU renderer with TSL.

---

## P0 — Must Fix Before Building On Top

### 1. In-Place Component Mutation with Dirty Tracking

**Problem**: Every component update requires allocating a new object via `addComponent`. For a 3D engine, Transform alone is 10 floats (position + rotation + scale). At 1000 entities running 60fps, that's 60K throwaway objects per second just for transforms — a GC disaster.

```ts
// Current: allocates a new object every frame per entity
world.addComponent(entity, "Transform", {
  position: [x + vx * dt, y + vy * dt, z + vz * dt],
  rotation: [rx, ry, rz, rw],
  scale: 1,
});
```

**Solution**: Add a `getMut` method that returns a direct reference to the stored component AND marks it as updated in the change tracker.

```ts
const t = world.getMut(entity, "Transform");
t.position[0] += vx * dt;
t.position[1] += vy * dt;
// change tracking sees it as updated automatically
```

Internally, `getMut` is just `getComponent` + `recordUpdated`. The key difference from `getComponent` is the semantic contract: the caller intends to mutate, so the world marks the component dirty.

**Files**: `ecs/types.ts` (add to `World` interface), `ecs/world.ts` (implement on `EcsWorld`).

---

### 2. Query Iteration Safety During Mutation

**Problem**: Queries iterate the live backing array of the base `SparseSetStore`. If a system destroys an entity or removes/adds a component during iteration, the sparse set's swap-remove can silently skip entities or double-process them.

```ts
// world.ts:208 — baseEntities is a LIVE array reference
const baseEntities = baseStore.entities();
for (const entity of baseEntities) { ... }
```

The `if (!baseStore.has(entity))` guard at line 211 catches stale entries but cannot prevent skipping when swap-remove moves the last element into the removed slot.

**Solution**: Snapshot the dense entity array at query start. Replace:

```ts
const baseEntities = baseStore.entities();
```

with:

```ts
const baseEntities = baseStore.entities().slice(); // snapshot
```

This adds one array copy per query per frame but guarantees correctness. The cost is negligible compared to the component object allocations the query already does. For the longer term, consider a deferred command buffer (see task 10) that eliminates the need for snapshots entirely.

**Files**: `ecs/world.ts` (query method).

---

### 3. Fix destroyEntity Listener Ordering

**Problem**: `destroyEntity` removes all components, then marks the entity dead in the entity manager, then fires destroy listeners. By the time listeners run, the entity ID is stale and all components are gone — listeners can't do anything useful (e.g., cleaning up Three.js scene objects that depend on component data).

```ts
// world.ts:53-66 — current order
for (const [type, store] of this.stores) { store.remove(entity); }  // components gone
this.entityManager.destroy(entity);                                  // ID now stale
for (const listener of this.destroyListeners) { listener(entity); } // too late
```

**Solution**: Fire listeners first (while the entity is still alive and components are still accessible), then remove components, then mark dead.

```ts
for (const listener of this.destroyListeners) { listener(entity); } // can still query
for (const [type, store] of this.stores) { store.remove(entity); }
this.entityManager.destroy(entity);
```

**Files**: `ecs/world.ts` (destroyEntity method). Update tests in `ecs/world.test.ts` if any assert on the current ordering.

---

## P1 — Required for a Functional 3D Engine

### 4. Resources / Singletons

**Problem**: Game engines need world-level state that isn't per-entity: elapsed time, input state, renderer context, physics configuration, asset manager, camera settings. There's no concept for this. The workaround is creating a dedicated entity with singleton components, which is clunky and pollutes queries.

**Solution**: Add a typed resource API to the world.

```ts
// Define resources separately from components
const resources = {
  Time: s.object({ dt: s.number(), elapsed: s.number() }),
  Input: s.object({ keys: s.map(s.boolean()) }),
};

// Usage in systems
world.setResource("Time", { dt, elapsed });
const time = world.getResource("Time");
```

Implementation: a simple `Map<string, unknown>` on the world, with type safety via a second generic parameter or a separate registry type. Resources don't need entity IDs, stores, change tracking, or query participation — just typed get/set.

**Files**: `ecs/types.ts` (add `ResourceRegistry` type, extend `World` interface), `ecs/world.ts` (implement storage + accessors).

---

### 5. System Phases / Stages

**Problem**: The scheduler is a flat array of functions. A 3D engine needs ordered execution stages to coordinate gameplay logic, physics, and rendering:

```
PreUpdate → FixedUpdate → Update → PostUpdate → PreRender → Render → PostRender
```

Physics must run at a fixed timestep. Rendering must happen after all transforms are finalized. Input polling must happen before gameplay. A flat list can't express this.

**Solution**: Extend the scheduler with named phases. Systems are registered into a phase, and phases execute in a fixed order.

```ts
const scheduler = new Scheduler(world, {
  phases: ["preUpdate", "fixedUpdate", "update", "postUpdate", "preRender", "render"],
});

scheduler.addSystem("update", movementSystem);
scheduler.addSystem("fixedUpdate", physicsSystem);
scheduler.addSystem("render", renderSyncSystem);

scheduler.runFrame(dt); // executes phases in declared order
```

Each phase is still a flat list internally (deterministic ordering within a phase). The `runFrame` method iterates phases in order, calling `beginFrame`/`endFrame` at appropriate boundaries. FixedUpdate should support fixed timestep accumulation.

**Files**: `ecs/systems.ts` (rewrite `Scheduler`), `ecs/types.ts` (add phase types if needed).

---

### 6. Entity Relationships / Parent-Child Hierarchy

**Problem**: 3D engines universally need scene graph hierarchies. Transform inheritance (child moves with parent), enabling/disabling subtrees, ordered traversal — none of this is possible without entity relationships.

**Solution**: Add built-in `Parent` and `Children` components, or a dedicated relationship API on the world.

Option A — Relationship API:

```ts
world.setParent(child, parent);
world.getParent(child);       // → EntityId | undefined
world.getChildren(parent);    // → EntityId[]
world.removeParent(child);
```

Internally, this maintains a `parentOf: Map<EntityId, EntityId>` and `childrenOf: Map<EntityId, EntityId[]>`. When an entity is destroyed, its children are either reparented to the grandparent or destroyed (configurable).

Option B — Convention components with helper functions. Less magic, more explicit.

Either way, the hierarchy is a prerequisite for implementing a `TransformSystem` that computes world-space matrices from local transforms by walking the tree.

**Files**: New file `ecs/hierarchy.ts` (or extend `ecs/world.ts`). Update `destroyEntity` to handle cascading/reparenting.

---

### 7. Tag / Marker Components

**Problem**: Flagging entities (Player, Enemy, Static, Visible, DebugDraw) currently requires a schema with dummy data:

```ts
Player: s.object({ value: s.boolean() })  // wastes memory, awkward API
```

**Solution**: Add a `s.tag()` schema type that carries no data. The ECS stores only presence/absence (a Set of entity IDs rather than a Map of entity → value).

```ts
const registry = {
  Player: s.tag(),
  Static: s.tag(),
  Transform: s.object({ ... }),
};

world.addComponent(entity, "Player");  // no data argument needed
world.hasComponent(entity, "Player");  // true
```

Internally, `addComponent` with a tag schema ignores the data argument (or accepts `undefined`/`true`). The store can use a lightweight `Set<EntityId>` instead of a full `SparseSetStore`.

**Files**: `schema.ts` (add `TagSchema` type + `s.tag()` builder), `ecs/storage.ts` (optional: `TagStore` class), `ecs/world.ts` (handle tag components in add/get), `ecs/types.ts` (update `ComponentData` to return `true` or `undefined` for tags).

---

## P2 — Performance and Scalability

### 8. Query Caching

**Problem**: Every call to `world.query(["Transform", "Velocity"])` re-selects the smallest store, re-iterates all entities, and re-checks membership in every other store. In a 3D engine with ~10 systems each querying per frame, this redundant work adds up.

**Solution**: Allow creating persistent query handles that the world updates incrementally.

```ts
// Created once (e.g., in system init)
const movables = world.createQuery(["Transform", "Velocity"]);

// Hot path: iterate without re-evaluating
for (const { entity, components } of movables) { ... }
```

Internally, a cached query maintains its matched entity set. When `addComponent` or `removeComponent` is called, the world checks affected queries and adds/removes the entity. This is the approach used by Bevy and Flecs.

Start simple: even just caching the "smallest store" selection and snapshotting the entity list per frame would be a win. Full incremental maintenance can come later.

**Files**: `ecs/world.ts` (add `createQuery`, hook into add/removeComponent), `ecs/types.ts` (add `CachedQuery` type).

---

### 9. Reduce Per-Frame Allocations

**Problem**: Multiple hot paths allocate on every call:

| Location | Allocation | Frequency |
|----------|-----------|-----------|
| `world.ts:240-249` | `components: {}` per query result | per entity per query per frame |
| `world.ts:285` | `Array.from(set)` in getAdded/Removed/Updated | per system per frame |
| `entity.ts:170` | Generator iterator in `*entities()` | per frame |
| `world.ts:153-154` | `[...include]`, `[...exclude]` array copies | per query per frame |

**Solution** (per item):

- **Query result objects**: Reuse a single result object, updating its fields each iteration (callers must not hold references across iterations — document this). Or switch to a callback-based API: `query.forEach((entity, transform, velocity) => { ... })`.
- **Change tracking getters**: Return `ReadonlySet<EntityId>` instead of copying to a new array. Callers that need an array can copy themselves.
- **Entity iteration**: Add `forEachEntity(callback)` alongside the generator, mirroring `SparseSetStore.forEachEntry`.
- **Query array copies**: Only copy once if the query is cached (see task 8).

**Files**: `ecs/world.ts`, `ecs/entity.ts`, `ecs/types.ts` (update return types).

---

### 10. Deferred Command Buffer

**Problem**: Systems that create or destroy entities during query iteration can cause correctness issues (see task 2). Snapshotting the entity array (task 2) is a quick fix, but the proper solution used by mature ECS engines is a command buffer: mutations are queued during system execution and applied between systems.

```ts
scheduler.addSystem((world, commands, dt) => {
  for (const { entity, components } of world.query(["Health"])) {
    if (components.Health.hp <= 0) {
      commands.destroyEntity(entity);  // deferred
      commands.createEntity();         // deferred
    }
  }
});
// commands are flushed automatically between systems (or at end of frame)
```

**Solution**: Introduce a `Commands` object that records mutations (create, destroy, addComponent, removeComponent) into an array. The scheduler flushes commands after each system runs. This eliminates iteration safety issues entirely and is the standard approach in Bevy, Flecs, and most production ECS frameworks.

**Files**: New file `ecs/commands.ts`, update `ecs/systems.ts` (inject commands into systems, flush after each), `ecs/types.ts` (define `Commands` interface).

---

### 11. SparseSetStore: Replace Map with Flat Array

**Problem**: `storage.ts:9` uses `Map<EntityId, number>` for the sparse index. Classic sparse sets use a flat array indexed by entity index for true O(1) lookup without hashing overhead. The Map adds per-lookup hash cost. With thousands of `has()` checks per frame across multiple stores during query matching, this is measurable.

**Solution**: Since entity IDs encode `generation * 1_000_000 + index`, extract the index with `entity % 1_000_000` and use it as an array index. The sparse array may have holes (undefined entries) but that's fine — undefined means "not present".

```ts
private readonly sparse: (number | undefined)[] = [];

has(entity: EntityId): boolean {
  const idx = getEntityIndex(entity);
  return this.sparse[idx] !== undefined && this.denseEntities[this.sparse[idx]] === entity;
}
```

The second check (`denseEntities[...] === entity`) ensures stale generations don't match. This is how textbook sparse sets work.

Trade-off: memory usage scales with max entity index rather than live entity count. At 1M capacity * 8 bytes = 8MB worst case, which is fine for a game engine.

**Files**: `ecs/storage.ts`. Need to pipe entity index extraction or capacity info into the store (or have the store extract the index itself using `getEntityIndex`).

---

### 12. EntityManager.reserve() Free-List Performance

**Problem**: `entity.ts:130-133`:

```ts
const freeIndex = this.free.indexOf(index);  // O(n) scan
this.free.splice(freeIndex, 1);              // O(n) shift
```

Loading a saved world with 10K entities means ~10K reserve calls, each scanning/splicing an array → O(n^2) total.

**Solution**: Use a `Set<number>` for the free list instead of an array. `Set.has()` and `Set.delete()` are O(1). For `create()`, which currently does `free.pop()`, use `Set.values().next().value` to grab an arbitrary element (or maintain both a Set and a stack, using the Set only for `reserve`'s lookup).

**Files**: `ecs/entity.ts`.

---

## P3 — Ergonomics and Completeness

### 13. Component Defaults at Addition Time

**Problem**: `addComponent` requires the full data object even when the schema defines sensible defaults.

```ts
// Annoying: must spell out every field
world.addComponent(entity, "Transform", { position: [0,0,0], rotation: [0,0,0,1], scale: 1 });
```

**Solution**: Make the data argument optional. When omitted or partial, merge with schema defaults via the existing `getDefault` / `materialize` infrastructure.

```ts
world.addComponent(entity, "Transform");                    // all defaults
world.addComponent(entity, "Transform", { scale: 2 });     // partial override
```

Implementation: in `addComponent`, if data is `undefined`, call `getDefault(registry[type])`. If data is provided, deep-merge with defaults (the `materialize` module already does this).

**Files**: `ecs/world.ts` (addComponent), `ecs/types.ts` (make data param optional).

---

### 14. Events System

**Problem**: No way to decouple systems through events. Systems that detect collisions need to communicate with systems that play sounds or apply damage, but currently the only mechanism is shared component state. This leads to tight coupling and ordering dependencies.

**Solution**: Add a simple typed event bus on the world.

```ts
// Emit from one system
world.emit("collision", { entityA, entityB, point });

// Read from another system (same frame)
for (const event of world.read("collision")) {
  // handle
}
```

Events are buffered per frame and cleared on `beginFrame()`. This is simpler than a full pub/sub — systems just read whatever events were emitted earlier in the frame. Event types can be defined in a separate registry for type safety.

**Files**: New file `ecs/events.ts`, extend `ecs/types.ts` (add event methods to `World` interface), integrate clearing into `ecs/world.ts` beginFrame/endFrame.

---

### 15. Batch Entity Creation

**Problem**: Spawning many entities with the same components (particles, bullets, instanced meshes) requires N individual calls:

```ts
for (let i = 0; i < 1000; i++) {
  const e = world.createEntity();
  world.addComponent(e, "Transform", { ... });
  world.addComponent(e, "Particle", { ... });
}
```

**Solution**: Add a batch/spawn API.

```ts
world.spawn(1000, {
  Transform: () => ({ position: [rand(), rand(), rand()], scale: 1 }),
  Particle: () => ({ lifetime: 2.0 }),
});
```

Internally, this pre-allocates entity IDs in bulk and appends to stores in batch, avoiding per-entity overhead. Change tracking records all as added.

**Files**: `ecs/world.ts` (add `spawn` method), `ecs/types.ts`.

---

### 16. World Clear / Reset

**Problem**: For scene transitions (loading a new level), there's no way to clear the world. You'd have to iterate and destroy every entity individually, including dealing with destroy listeners firing for each one.

**Solution**: Add `world.clear()` that efficiently resets all internal state.

```ts
world.clear();  // all entities dead, all stores empty, all changes flushed
```

Optionally fire a bulk "world cleared" event instead of per-entity destroy callbacks. The entity manager resets its generation array and free list. All stores call `clear()`.

**Files**: `ecs/world.ts`, `ecs/entity.ts` (add `reset()` to `EntityManager`).

---

### 17. Entity Count and Debug Stats

**Problem**: No way to inspect the world's state for profiling or debugging. You can't ask "how many entities are alive?" or "how many entities have a Transform?" without iterating manually.

**Solution**: Expose read-only stats.

```ts
world.entityCount;                    // alive entity count
world.componentCount("Transform");    // number of entities with Transform
world.stats();                        // { entities: 1523, components: { Transform: 1200, ... } }
```

The entity manager already tracks `aliveCount`. Each store already has `size`. This is just exposing existing data.

**Files**: `ecs/world.ts`, `ecs/types.ts` (add to `World` interface).

---

## Future Considerations (Not Immediate Tasks)

These are noted for architectural awareness but don't need implementation now:

- **Typed-array / SoA backing for numeric components**: For GPU buffer upload via WebGPU, numeric components (Transform, Color) would ideally be backed by `Float32Array` in a struct-of-arrays layout. This is a deep architectural change that would affect storage, queries, and the mutation API. Worth designing for but not blocking v1.

- **Archetype-based storage**: The current per-component sparse set design is simple and fast for small-to-medium entity counts. Archetype storage (grouping entities with identical component sets into contiguous tables) offers better cache locality for multi-component queries at scale. This is the approach used by Bevy and Flecs. Consider if/when entity counts exceed ~10K with complex queries.

- **Web Worker / SharedArrayBuffer support**: If physics or AI ever move to web workers, the current JS-object-based stores can't be shared without serialization. Typed-array backing (above) would enable zero-copy sharing.

- **Reactive component handlers for Three.js sync**: A pattern like Bevy's `Added<T>` / `Changed<T>` / `Removed<T>` query filters would make the ECS → Three.js scene graph bridge much cleaner. The change tracking system is already most of the way there; it just needs to be queryable as filters rather than separate API calls.
