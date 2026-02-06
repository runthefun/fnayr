# Engine Architecture

## Vision

This is a **3D web game engine** built on **Three.js** with the **WebGPU renderer** and **TSL** (Three Shading Language) for shader authoring. The engine targets the browser as a first-class platform, leveraging modern web APIs for GPU-accelerated rendering.

Core design goals:

- **Data-driven architecture** — All game state is represented as plain, schema-typed data. Behavior is expressed through systems that operate on that data, not through class hierarchies or imperative scene graph manipulation. This separation makes the engine predictable, testable, and introspectable.

- **Studio authoring** — The engine is designed from the ground up to support visual editing tools. Schemas describe the shape of every component, resource, and asset reference, enabling editors to auto-generate property panels, validate user input, and provide meaningful defaults — all without hand-written UI code.

- **Serializability** — Every piece of game state (entities, components, resources, hierarchy) can be round-tripped to and from JSON. This enables scene files, save/load, undo/redo, networked state sync, and editor ↔ runtime communication. Unknown components are preserved across round-trips so the editor never drops data it doesn't understand.

- **Type safety end-to-end** — Schema definitions flow through the entire stack via TypeScript generics. Component types, query results, resource access, and event payloads are all inferred from the registry — no manual type annotations or casts needed at usage sites.

---

## Overview

The engine is a TypeScript game/application engine built around two main pillars:

1. **Schema-driven data layer** — a runtime type system for defining, validating, serializing, and deserializing structured data.
2. **Entity Component System (ECS)** — a data-oriented runtime for managing entities, components, queries, systems, and world state.

Both layers are designed to be fully generic over user-defined registries, giving strong type inference throughout.

```
src/engine/
├── schema.ts          # Schema type definitions and builder (`s.*`)
├── validate.ts        # Runtime validation against schemas
├── materialize.ts     # Default-filling + validation (deserialize path)
├── codec.ts           # Serialize / deserialize between runtime values and JSON
├── math.ts            # Math codecs (Vec2, Vec3, Mat4, Color, etc.)
├── asset.ts           # Asset reference schema and codec
├── world.ts           # JSON ↔ World parse/serialize (data-level, no ECS runtime)
├── index.ts           # Public re-exports
└── ecs/
    ├── types.ts       # Core ECS type definitions and interfaces
    ├── entity.ts      # EntityManager — generational entity IDs
    ├── storage.ts     # SparseSetStore — component storage
    ├── world.ts       # EcsWorld — runtime world implementation
    ├── systems.ts     # Scheduler — phased system execution
    ├── commands.ts    # CommandBuffer — deferred mutation
    ├── hierarchy.ts   # Hierarchy — parent-child entity relationships
    ├── events.ts      # EventBus — frame-buffered event system
    ├── bridge.ts      # JSON ↔ EcsWorld hydration/serialization
    └── index.ts       # ECS re-exports
```

---

## Layer 1: Schema System

### Schema Definition (`schema.ts`)

Schemas are plain objects with a `type` discriminator. The `s` builder provides a fluent API:

```ts
s.string()                        // StringSchema
s.number({ min: 0, integer: true }) // NumberSchema with constraints
s.object({ x: s.number(), y: s.number() }) // ObjectSchema
s.array(s.string())               // ArraySchema
s.enum(["a", "b", "c"] as const)  // EnumSchema
s.tagged({ walk: s.object({...}), run: s.object({...}) }) // TaggedUnionSchema
s.tag()                           // TagSchema (marker, no data)
s.optional(s.string())            // OptionalSchema
s.tuple([s.number(), s.number()]) // TupleSchema
s.map(s.number())                 // MapSchema
s.literal(42)                     // LiteralSchema
```

The `SchemaValue<S>` conditional type recursively maps any schema to its TypeScript runtime type. `InferSchema<S>` is the user-facing alias that also flattens intersections for readability.

**Key design choice:** Schemas are inert data — no classes, no prototype chains. This makes them serializable, inspectable, and trivially composable.

### Validation (`validate.ts`)

`validate(schema, value)` walks the schema tree and collects `{ path, message }` issues. Paths use JSON-pointer style (`$.entities[0].components.position.x`). Validation is non-throwing; it always returns an array of issues.

### Materialization (`materialize.ts`)

`materialize(schema, value)` fills in missing properties with schema-defined defaults, then validates the result. This is the standard deserialization path — partial input goes in, fully-populated typed output comes out.

### Codec (`codec.ts`)

`serialize` and `deserialize` are the top-level JSON ↔ runtime round-trip functions. Serialization strips undefined values by default and optionally strips unknown properties. Deserialization delegates to `materialize` when `applyDefaults` is enabled (the default).

### Math Types (`math.ts`)

Pre-built tuple schemas and codecs for game-relevant types: `Vec2`, `Vec3`, `Vec4`, `Quat`, `Mat4`, `Color`. Each exports a schema, a TypeScript type, and a codec object with `encode`/`decode` methods.

### Asset References (`asset.ts`)

An `AssetRef` schema for referencing external resources (textures, GLB models, audio/video clips). Uses `meta: { kind: "assetRef" }` to allow tooling to identify asset reference fields by schema introspection.

### World Parse/Serialize (`world.ts`)

Operates at the data level (no ECS runtime). `parseWorld` takes raw JSON and a component registry, validates structure, deserializes each entity's components, and collects issues. `serializeWorld` does the reverse. This layer handles unknown-component preservation for editor round-tripping.

---

## Layer 2: Entity Component System

### Entity IDs (`entity.ts`)

Entity IDs are opaque numbers encoding an **index** and a **generation**:

```
EntityId = generation * 1_000_000 + index
```

- **Index** — slot in the entity manager arrays (0 to capacity-1).
- **Generation** — incremented on destroy, so stale references are safely detected.
- The `EntityManager` tracks alive/dead status with flat `boolean[]` and `number[]` arrays.
- A `Set<number>` free list enables O(1) create/destroy.
- `reserve(entityId)` supports loading saved entity IDs at specific slots.

**Key design choice:** Generational IDs avoid the ABA problem (reusing an index for a new entity while old references still exist). The flat-array encoding avoids object allocation per entity.

### Component Storage (`storage.ts`)

`SparseSetStore<T>` implements the `ComponentStore<T>` interface using the classic sparse-set pattern:

- **Dense arrays** (`denseEntities[]`, `denseValues[]`) — tightly packed, cache-friendly iteration.
- **Sparse array** (`sparse[]`) — indexed by entity index, maps to dense position.
- `has`/`get`/`set` are O(1). `remove` uses swap-remove (O(1) amortized).
- Generation safety: `has`/`get` verify the dense entity matches the requested ID, preventing stale hits.

**Key design choice:** Flat arrays indexed by entity index replace the earlier `Map<EntityId, number>`, eliminating hash overhead and improving cache locality. Swap-remove keeps the dense array packed without gaps.

### ECS World (`ecs/world.ts`)

`EcsWorld<R, Res, E>` is the central runtime, generic over three registries:

- `R` — Component registry (what components exist and their schemas).
- `Res` — Resource registry (singleton values, not per-entity).
- `E` — Event registry (typed event channels).

Core responsibilities:

| Concern | API |
|---|---|
| Entity lifecycle | `createEntity`, `destroyEntity`, `isAlive`, `entities`, `spawn` |
| Component CRUD | `addComponent`, `removeComponent`, `getComponent`, `getMut`, `hasComponent` |
| Querying | `query` (on-demand), `createQuery` (cached/incremental) |
| Change tracking | `getAdded`, `getRemoved`, `getUpdated`, `beginFrame`/`endFrame`/`flushChanges` |
| Resources | `setResource`, `getResource`, `hasResource` |
| Events | `emit`, `read` |
| Debug | `entityCount`, `componentCount`, `stats` |
| Lifecycle | `clear` (full reset with listener callbacks) |

**Destroy ordering:** `destroyEntity` fires destroy listeners *before* removing components and marking the entity dead. This allows cleanup code (hierarchy cascade, serialization snapshots, etc.) to access component data during teardown.

**Component defaults:** `addComponent` without data uses `getDefault(schema)` to populate the component from schema defaults. Tag components always receive `true`.

### Change Tracking

Each component type maintains per-frame `added`/`removed`/`updated` sets. Smart deduplication rules apply:

- Add then remove in the same frame → neither set records the entity.
- Add then update in the same frame → only `added` records it (the update is redundant).
- Update then remove → only `removed`.

`beginFrame()` clears all change sets (and event buffers). `endFrame()` clears change sets again. Systems read changes between these boundaries.

### Queries

**On-demand queries** (`world.query(include, { exclude })`) use a generator that:

1. Picks the smallest included store as the iteration base (smallest-set optimization).
2. Snapshots the base entity array with `.slice()` for safe iteration during mutation.
3. Checks all other included stores and exclude stores per entity.

**Cached queries** (`world.createQuery(include, { exclude })`) maintain a live `Set<EntityId>` of matched entities, updated incrementally on `addComponent`/`removeComponent`/`destroyEntity`. Initial population uses the on-demand query. Iteration snapshots the set to `Array.from()` for mutation safety.

**Key design choice:** Two query tiers balance simplicity vs. performance. On-demand queries have zero setup cost; cached queries amortize matching cost across frames for hot-path iteration.

### System Scheduler (`systems.ts`)

The `Scheduler` organizes systems into **named phases** with a deterministic execution order:

```ts
const scheduler = new Scheduler(world, ["input", "update", "render"]);
scheduler.addSystem("input", inputSystem);
scheduler.addSystem("update", physicsSystem);
scheduler.addSystem("render", drawSystem);
scheduler.runFrame(dt);
```

- Default phase list is `["update"]` for backward compatibility.
- Each system receives `(world, dt, commands)`.
- `runFrame` calls `beginFrame()`, runs all phases in order, then `endFrame()`.
- Systems can be dynamically enabled/disabled/removed at runtime.

**Key design choice:** Phase-based scheduling over dependency graphs — simpler to reason about, explicit ordering, no topological-sort overhead.

### Command Buffer (`commands.ts`)

The `CommandBuffer` implements the `Commands` interface for deferred mutation:

- `createEntity()` executes **immediately** (so the returned ID is usable in subsequent commands).
- `destroyEntity`, `addComponent`, `removeComponent` are **buffered** and applied on `flush()`.
- The scheduler creates a fresh `CommandBuffer` per system and flushes it after the system returns.

**Key design choice:** Deferred commands prevent iterator invalidation. Systems can safely query and iterate while queueing structural changes. Immediate `createEntity` avoids the need for placeholder IDs.

### Entity Hierarchy (`hierarchy.ts`)

`Hierarchy` manages parent-child relationships as an opt-in add-on:

- `parentOf` map (child → parent) and `childrenOf` map (parent → children[]).
- `setParent` validates liveness, prevents self-parenting, and detects cycles via ancestor walk.
- Reparenting automatically removes from the old parent.
- **Cascade destroy** — a destroy listener on the world walks children depth-first, destroying each descendant. Snapshots prevent mutation-during-iteration.

**Key design choice:** Hierarchy is external to the core ECS world (composition over inheritance). It hooks into the destroy listener system rather than being baked into `destroyEntity`.

### Event Bus (`events.ts`)

`EventBus<E>` provides frame-buffered, typed event channels:

- `emit(type, data)` appends to a per-type buffer.
- `read(type)` returns the buffer as a readonly array (all events emitted so far this frame).
- `flush()` clears all buffers — called automatically by `beginFrame()`.

**Key design choice:** Frame-buffered (not immediate callback) design means order-of-execution between producer and consumer systems doesn't matter within a frame. All systems see the same event snapshot.

### Bridge (`bridge.ts`)

`worldFromJson` and `worldToJson` bridge between the data-level world representation (`world.ts`) and the runtime ECS world:

- `worldFromJson` parses JSON, creates an `EcsWorld`, reserves entity IDs, and hydrates components.
- Unknown components are stored in a `WeakMap` side-channel, cleaned up via destroy listeners.
- `worldToJson` iterates alive entities, reads components, and delegates to `serializeWorld`.

---

## Cross-Cutting Design Principles

### Registry-Driven Generics

All core types (`World<R, Res, E>`, `ComponentData<R, K>`, `Query<R, Include>`) are generic over user-defined registries. This gives full TypeScript inference from schema definition through to system code — no `as` casts needed at usage sites.

### Allocation Awareness

Several design choices target low per-frame allocation:

- Change tracking returns `ReadonlySet` instead of allocating new arrays.
- `forEachEntity` callback avoids generator allocation.
- Sparse set uses flat arrays instead of `Map`.
- Event buffers reuse arrays (clear via `.length = 0` instead of re-allocating).

### Composition Over Monolith

The ECS world is the only required piece. Hierarchy, events, command buffers, and the scheduler are all optional add-ons that compose with the world through its public interface and listener hooks. This keeps the core small and allows applications to use only what they need.

### Mutation Safety

Multiple mechanisms protect against mutation-during-iteration bugs:

- Query iteration snapshots the entity array with `.slice()`.
- Cached query iteration snapshots via `Array.from()`.
- `CommandBuffer` defers structural changes until after system execution.
- `Hierarchy` cascade destroy snapshots children before iterating.
- `destroyEntity` fires listeners before removing data, so listeners see a consistent state.
