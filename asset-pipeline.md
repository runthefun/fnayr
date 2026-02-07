# Asset Pipeline: GLTF Loading (Milestones 1+2)

## Context

The engine has a schema-driven ECS with rendering, but only supports procedural geometry (`MeshRenderer`: box/sphere/plane). `AssetRef` exists but is not wired into runtime loading yet.

Goal: add an async asset-loading pipeline starting with GLTF/GLB, and keep it extensible for texture/audio later. The design must bridge async completion into synchronous per-frame systems.

## Architecture

```text
AssetManager (src/engine/assets/)                // cache, dedup, refcount, completion queues
    ^
GltfAssetLoader (Three.js GLTFLoader wrapper)    // type-specific loader
    ^
assetRequestSystem (generic)                     // discovers AssetRef fields via schema meta, issues request()
lightSyncSystem (light-specific)                 // owns its own light map, independent of ThreeBinding
modelResolveSystem (GLTF-specific)               // drains completions + polls pending, instantiates clones
renderSyncSystem (mesh-specific)                 // syncs MeshRenderer to binding
```

## Key Decisions

- `AssetManager` stays engine-level and Three-agnostic.
- `assetRequestSystem` is generic and discovers asset fields via `schema.meta?.kind === "assetRef"`.
- Resolve is per-asset-type (`createModelResolveSystem` for GLTF).
- Cache key is `type::uri` (`sub` is not part of cache key).
- `ModelRenderer` is format-agnostic; `AssetRef.type` picks resolve behavior.
- **Lights are fully independent of the binding map.** `lightSyncSystem` owns a separate `Map<EntityId, THREE.Light>` per light type, adds/removes lights from the scene directly. No conflict with `ThreeBinding`.
- **No mutual exclusion between lights and models/meshes.** An entity can have both a light component and a `ModelRenderer` or `MeshRenderer` — they occupy independent scene slots.
- **No mutual exclusion enforcement between `ModelRenderer` and `MeshRenderer`.** Both share a single `ThreeBinding` slot, but coexistence is handled via **unidirectional overwrite + a single guard** — no `removeComponent` commands, no deferred sets, no cross-system state sharing, no multi-frame resolution:
  - `modelResolveSystem` calls `binding.set()` which replaces any existing mesh in one frame.
  - `renderSyncSystem` checks `hasComponent("ModelRenderer")` before creating a mesh — one `if` statement.
  - No system ever removes the other system's component. This is what avoids the original plan's complexity, which came from bidirectional `removeComponent` calls between systems triggering cascading deferred sets and multi-frame conflict resolution.
- Stale safety uses per-slot `version`.
- Immediate clear on model target change is explicit (via `clearOnPending` slot flag).
- Non-scheduler/manual system execution must flush commands between systems.
- Light helpers are owned and managed entirely by `lightSyncSystem`.

## Prerequisites

### World resource registry requirement

Worlds that run asset systems must include `renderingResources`:

```ts
const world = createWorld(renderingRegistry, { resources: renderingResources });
```

Without this, `setResource("LoadingState", ...)` is not valid.

Existing code that uses `createWorld(renderingRegistry)` without resources is NOT modified — resources are only required for worlds that run the asset systems.

### Resource typing in systems

Keep `System<R>`/`Scheduler<R>` unchanged. Use targeted cast for `setResource` inside asset systems:

```ts
(world as any).setResource("LoadingState", ...)
```

This matches existing code patterns (e.g., `world.getComponent(entity, "MeshRenderer" as any)`) and avoids a broad generic threading refactor.

### Manual runner flush requirement (non-scheduler paths)

If systems are run manually with a shared `CommandBuffer` (for example editor-style loops), flush after each system so commands are visible to subsequent systems in the same frame.

Required manual order:

```text
lightSyncSystem(...)
commands.flush()
assetRequestSystem(...)
commands.flush()      // slot updates visible to resolve
modelResolveSystem(...)
commands.flush()
renderSyncSystem(...)
commands.flush()
transformSyncSystem(...)
commands.flush()
world.flushChanges()
```

If using `Scheduler.runFrame()`, this already happens automatically (each system gets a fresh `CommandBuffer` that is flushed immediately after the system returns).

## Files

### New

- `src/engine/assets/types.ts` — `AssetEntry`, `AssetLoader<T>`, `AssetStatus`
- `src/engine/assets/manager.ts` — `AssetManager`
- `src/engine/assets/index.ts` — re-exports
- `src/engine/assets/manager.test.ts` — manager unit tests
- `src/engine/rendering/loaders/gltf-loader.ts` — `GltfAssetLoader`
- `src/engine/rendering/loaders/index.ts` — re-exports
- `src/engine/rendering/asset-sync.test.ts` — ECS + binding integration tests

### Modified

- `src/engine/rendering/components.ts` — add `ModelRenderer`, `SpotLight`, `LoadingState`, `renderingResources`
- `src/engine/rendering/systems.ts` — add `createAssetRequestSystem`, `createModelResolveSystem`, `instantiateGltf`, failed-path handling
- `src/engine/rendering/lights.ts` — refactor to use own `Map<EntityId, THREE.Light>` per light type instead of `ThreeBinding`, add `SpotLight` support, add `addToScene`/`removeFromScene` via passed-in `THREE.Scene`
- `src/engine/rendering/index.ts` — export new systems/loaders

## Detailed Design

### 1. AssetManager (`src/engine/assets/manager.ts`)

Core API:

```ts
type AssetStatus = "loading" | "ready" | "error";

type AssetEntry = {
  status: AssetStatus;
  asset: unknown | undefined;
  error: Error | undefined;
  refCount: number;
};

interface AssetLoader<T> {
  load(uri: string, options?: Record<string, unknown>): Promise<T>;
  dispose(asset: T): void;
}

class AssetManager {
  registerLoader(type: string, loader: AssetLoader<unknown>): void;
  hasLoader(type: string): boolean;
  request(type: string, uri: string, options?: Record<string, unknown>): AssetEntry;
  release(key: string): void;
  peek(key: string): AssetEntry | undefined;
  drainReady(): ReadonlySet<string>;
  drainFailed(): ReadonlySet<string>;
  invalidate(key: string): void;
  getStats(): { total: number; loading: number; ready: number; error: number };
  dispose(): void;
  static cacheKey(type: string, uri: string): string;
}
```

Behavior:

- `request()` is synchronous, starts or reuses async load, increments `refCount`.
- `request()` throws if no loader is registered for `type`. However, callers (i.e. `assetRequestSystem`) must guard against this — see "unsupported type handling" below.
- Promise settle mutates entry and appends key to `_justReady` / `_justFailed`.
- `drainReady()` / `drainFailed()` are atomic return-and-clear (no `flushChanges` coupling).
- Cache key is `type::uri`; `sub` selection happens at resolve time.
- Different `options` with same `type+uri` share one cache entry (options are non-cache-variant).
- `release()` decrements count; at zero, dispose and delete cache entry.
- `release()` for an unknown/missing key is a no-op (idempotent cleanup path).
- Stale-settle safety: when `request()` creates a new entry and fires its promise, the `.then()` callback captures the entry object reference. On settle, it checks `this.cache.get(key) === capturedEntry`. If the entry was released and re-requested (same key, new entry object), the old callback sees a reference mismatch and disposes the settled asset immediately without mutating the new entry or adding to `_justReady`. This is an identity check, not just key-existence + refCount, which prevents the race where release→re-request of the same key causes the old promise to corrupt the new entry.
- If released to zero while load is in-flight (no re-request): the entry is deleted from cache, so `this.cache.get(key)` returns `undefined` — identity check fails, settled asset is disposed. This prevents leaks from orphaned async loads.
- `invalidate(key)` removes only error entry; retry needs caller-side component touch to re-trigger request.

### 2. GLTF loader (`src/engine/rendering/loaders/gltf-loader.ts`)

```ts
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

type GltfAsset = { gltf: GLTF };

class GltfAssetLoader implements AssetLoader<GltfAsset> {
  constructor(loader?: GLTFLoader);
  load(uri: string): Promise<GltfAsset>;
  dispose(asset: GltfAsset): void;
}
```

Disposal traverses original scene and disposes geometry/material/texture resources.

### 3. `ModelRenderer` component (`src/engine/rendering/components.ts`)

```ts
export const ModelRenderer = defineSchema(
  s.object({
    asset: assetRefSchema,
  })
);
```

- Add to `renderingRegistry`.
- Keep component format-agnostic.
- Asset type comes from `asset.type`.

Coexistence rules (model/mesh share `ThreeBinding`, lights are independent):

- **Lights are independent.** Lights use their own maps (not `ThreeBinding`), so lights and models/meshes freely coexist on the same entity with no conflicts.
- **`ModelRenderer` overwrites `MeshRenderer` — unidirectional, single-frame.** When model instantiation succeeds, the resolve system calls `binding.set(entity, clone)` which replaces any existing mesh binding in one frame. No `removeComponent("MeshRenderer")` is issued — the `MeshRenderer` component stays, only the binding slot changes. This avoids the bidirectional `removeComponent` pattern that caused the original plan's deferred-set complexity.
- **`MeshRenderer` yields to `ModelRenderer` — one guard, no deferral.** `renderSyncSystem` checks `world.hasComponent(entity, "ModelRenderer" as any)` before creating a mesh. If true, it simply skips — no deferred set, no tracking state. If `ModelRenderer` is later removed, `renderSyncSystem` can pick up `MeshRenderer` on the next `getUpdated` or via a component touch.

### 4. `SpotLight` component (`src/engine/rendering/components.ts`)

Add to `components.ts`:

```ts
export const SpotLight = defineSchema(
  s.object({
    color: s.number({ integer: true, default: 0xffffff }),
    intensity: s.number({ default: 1 }),
    distance: s.number({ default: 0 }),
    angle: s.number({ default: Math.PI / 3 }),
    penumbra: s.number({ default: 0 }),
    decay: s.number({ default: 2 }),
    castShadow: s.boolean({ default: false }),
    showHelper: s.boolean({ default: false }),
  })
);
```

Add to `renderingRegistry`:

```ts
export const renderingRegistry = {
  Transform3D,
  MeshRenderer,
  ModelRenderer,
  DirectionalLight,
  PointLight,
  SpotLight,
  AmbientLight,
} as const;
```

### 5. `LoadingState` resource (`src/engine/rendering/components.ts`)

```ts
export const LoadingState = defineSchema(
  s.object({
    pending: s.number({ integer: true, default: 0 }),
    ready: s.number({ integer: true, default: 0 }),
    failed: s.number({ integer: true, default: 0 }),
    total: s.number({ integer: true, default: 0 }),
    blockGameplay: s.boolean({ default: false }),
  })
);

export const renderingResources = {
  LoadingState,
} as const;
```

`assetRequestSystem` writes `LoadingState` each frame by computing counts from the **slot map**, not from `assetManager.getStats()`. This ensures that unsupported-type slots (which never call `request()` and therefore don't exist in manager stats) are correctly counted. Specifically:

- `pending` = number of slots with `status === "pending"`
- `ready` = number of slots with `status === "active"`
- `failed` = number of slots with `status === "failed"`
- `total` = total number of slots

This makes `LoadingState` reflect the ECS-visible loading state, which is what callers care about (e.g., "are all my entities loaded?"). The manager's `getStats()` method still exists for debugging/diagnostics but is NOT the source of truth for `LoadingState`.

### 6. Request/Resolve systems (`src/engine/rendering/systems.ts`)

#### Required order

Render phase order:

1. `lightSyncSystem`
2. `assetRequestSystem`
3. `modelResolveSystem`
4. `renderSyncSystem`
5. `transformSyncSystem`

With scheduler, per-system flush guarantees:
- Request system slot updates (creation, deletion, status changes) are visible to resolve system in the same frame.

This order enables same-frame behaviors:
- Cached-hit instantiation (request creates slot, resolve sees ready cache entry same frame).
- Same-key sub-switch (request sets `clearOnPending`, resolve clears and re-instantiates same frame).
- Empty-URI cleanup (resolve sees component update with empty URI and clears binding same frame).

#### `createAssetRequestSystem` (generic)

Schema discovery:

- On system creation, walk each component schema once and cache discovered asset-ref paths (no per-frame schema traversal).
- Supported recursion targets:
  - `schema.type === "object"`: recurse into each value in `schema.properties`.
  - `schema.type === "optional"`: recurse into `schema.inner`.
- Detect `schema.meta?.kind === "assetRef"` at any node (leaf or intermediate).
- Schema types NOT recursed (known limitation for milestone 1): `array`, `tuple`, `map`, `taggedUnion`. These are skipped because nesting an `AssetRef` inside a collection type is not a supported pattern yet.
- Milestone-1 constraint: one AssetRef path per component.
- If more than one path is found in same component, throw:
  `"Multiple AssetRef fields per component not yet supported: ${componentType}"`.

Slot ownership and shape:

```ts
type SlotEntry = {
  key: string;       // cache key (type::uri), or "" for failed-type slots
  type: string;      // original asset type from AssetRef (stored for failed-type re-check)
  uri: string;       // original URI from AssetRef (stored for broadcast retry)
  options?: Record<string, unknown>; // original options from AssetRef (stored for broadcast retry)
  version: number;
  sub?: string;
  status: "pending" | "active" | "failed";
  clearOnPending: boolean;
};
```

- Canonical map owned by request system (`Map<slotKey, SlotEntry>`).
- Resolve system may mutate `status` and `clearOnPending`; never creates/deletes slots.
- Request system is sole caller for slot deletion + `release()`.
- `uri` and `options` are stored explicitly to support broadcast retry (step 14).

`slotKey(entity, componentType)` helper currently returns `${entity}:${componentType}`.

Per-frame logic:

1. Process `getAdded` and `getUpdated` for each asset-bearing component.
2. Extract `AssetRef` from discovered field path.
3. `getAdded` with empty `uri`: skip (no slot created).
4. `getAdded` with non-empty `uri`: validate `assetManager.hasLoader(ref.type)`. If no loader registered, log warning (`"No loader registered for asset type '${ref.type}', skipping entity ${entity}"`) and create slot with `status = "failed"`, `key = ""`, `type = ref.type`, `uri = ref.uri`, and `options = ref.options` (so it's counted in `LoadingState.failed` via slot map; no `release()` needed on cleanup since no `request()` was made). Do NOT call `request()` — avoids frame-time throw. If loader exists, call `request(type, uri, options)`, create slot with `pending`, `type = ref.type`, `uri = ref.uri`, and `options = ref.options`.
5. `getUpdated` — **first check if no existing slot** (covers the case where `getAdded` was skipped due to empty URI): if no slot exists for this entity+component, treat exactly like `getAdded` (step 4). This handles the `empty URI on add → non-empty URI on update` path.
6. `getUpdated` branch A (cache key changed): release old key (only if `key !== ""`); validate loader for new type (if missing, log warning, set slot `failed` with `key = ""`, `type = ref.type`, `uri = ref.uri`, `options = ref.options`, skip request); otherwise request new key; bump version; update `sub`, `type`, `uri`, and `options`; set `status = "pending"`; set `clearOnPending = (old status was "active")`.
7. `getUpdated` branch B (same key, `sub` changed): no release/request; update `sub`; if slot was active then set `status = "pending"` and `clearOnPending = true` (forces immediate clear + re-instantiate from same cached asset).
8. `getUpdated` branch C (same key+sub, but key is non-empty and `peek(key)` missing due to invalidate): call `request()`; set `status = "pending"`; `clearOnPending = false`. **Guard**: this branch is only entered when `key !== ""`. Failed-type slots (`key === ""`) never reach this branch — they fall through to branch D instead, which checks for type re-validation (see below).
9. `getUpdated` branch D (same key+sub and either cache entry exists or key is empty):
    - If `key === ""` (failed-type slot): re-check `assetManager.hasLoader(slot.type)`. If a loader is now registered (hot-registered after initial failure), treat as branch A with old key `""` (no release needed), call `request(slot.type, slot.uri, slot.options)`, update slot to `pending` with real key. If still no loader, no-op.
    - Otherwise: no-op.
10. `getUpdated` branch E (URI becoming empty): if new `uri` is empty and slot exists, mark the slot for cleanup (add `slotKey` to a separate "empty URI cleanup" set), but do NOT call `release()` or delete the slot yet. The cleanup set will be processed in a separate pass after all component updates are done (see step 12).
11. `getRemoved`: if slot exists, `release(storedKey)` (only if `key !== ""`), delete slot, regardless of slot status.
12. **Empty-URI cleanup pass** (runs after all component `getAdded`/`getUpdated`/`getRemoved` processing is complete): For each `slotKey` in the "empty URI cleanup" set, retrieve the slot. If it still exists, call `release(storedKey)` (only if `key !== ""`") and delete the slot. Clear the "empty URI cleanup" set for the next frame. Note: The resolve system will handle binding cleanup for empty-URI transitions via its own component-change detection (see resolve system step 1).
13. Dead-entity prune: for each slot where `!world.isAlive(entity)`, `release(key)` (only if `key !== ""`), delete slot.
14. **Broadcast invalidate handling**: The request system exposes a public method `retryFailed(key: string)` that can be called by external code (e.g., UI retry button). When called, it scans all slots: for each slot where `status === "failed"` and `slot.key === key` (or `key === ""` and `AssetManager.cacheKey(slot.type, slot.uri) === key` for failed-type slots), call `request(slot.type, slot.uri, slot.options)` to transition the slot to `pending` and increment the refcount. This ensures correct refcounts for all affected slots, even those not explicitly touched via component mutation. The `retryFailed` method should also call `assetManager.invalidate(key)` internally to ensure the error entry is removed from the cache before re-requesting.
15. Update `LoadingState` from slot map counts via `(world as any).setResource(...)`.

**Unsupported type handling**: `assetManager.request()` throws on unregistered type, which would crash the frame. The request system guards against this by checking `assetManager.hasLoader(type)` before calling `request()`. Add `hasLoader(type: string): boolean` to `AssetManager` API. Failed-type slots are created with `status = "failed"`, `key = ""`, `type = ref.type`, `uri = ref.uri`, and `options = ref.options` (preserving the original data for re-validation and broadcast retry). On cleanup (removal/destroy), `release()` is skipped for `key === ""` slots. On subsequent `getUpdated` where the ref is unchanged (branch D), the system re-checks `hasLoader(slot.type)`, allowing recovery if the loader is registered after the initial failure.

**Public API for retry**: The request system must expose a way for external callers to trigger broadcast retry. Signature:

```ts
function retryFailed(key: string): void;
```

This method is stored as a closure-accessible function returned alongside the system, or attached as a property to the system function object. Example:

```ts
const assetRequestSystem = createAssetRequestSystem(assetManager, slots);
assetRequestSystem.retryFailed = (key: string) => { /* broadcast logic */ };
```

### `createModelResolveSystem` (GLTF-specific)

Signature:

```ts
function createModelResolveSystem(
  assetManager: AssetManager,
  binding: ThreeBinding,
  slots: Map<string, SlotEntry>
): System<R>
```

The `slots` map is owned by the request system and passed in at system creation time (closure capture). The resolve system reads and mutates slot entries but never creates or deletes slots.

Frame logic:

1. **Empty-URI cleanup pass**: Scan all entities with `getUpdated("ModelRenderer")`. For each entity, extract the `AssetRef` from the component. If `uri` is now empty and `binding.has(entity)`, call `binding.delete(entity)` to clear the binding. This pass runs before any other resolve logic, ensuring that non-empty→empty URI transitions clear the scene binding. Note: The request system handles slot deletion for empty-URI transitions (see request system step 12).
2. **Model-removal cleanup pass**: scan all entities with `getRemoved("ModelRenderer")`. For each entity, if `binding.has(entity)`, call `binding.delete(entity)` to remove the model from the scene.
3. **Component-presence gate** (authoritative): For all subsequent resolve processing (pre-clear, Path A, Path B), only process slots where the entity is alive and the `ModelRenderer` component is still present. Check `world.isAlive(entity) && world.hasComponent(entity, "ModelRenderer" as any)` before any instantiation or binding mutation. This prevents stale slot processing when `ModelRenderer` is removed but the request system hasn't yet deleted the slot. If the check fails, skip the entity entirely.
4. **Pre-clear pass** (clearOnPending): for slots where `status === "pending"` and `clearOnPending === true`, if the component-presence gate passes, call `binding.delete(entity)` and set `clearOnPending = false`. This makes key/sub switches clear old model immediately.
5. **Path A (newly ready)**: `drainReady()`, match pending slots by key. For each match, if the component-presence gate passes, perform stale-check on version, then instantiate.
6. **Path B (already-ready cache hits)**: scan pending slots, `peek(key)?.status === "ready"`. For each match, if the component-presence gate passes, instantiate.
7. **Path C (failed)**: `drainFailed()`, mark matching pending slots as `failed`, optional warning log.

Instantiation rules:

1. Clone with `SkeletonUtils.clone(gltf.scene)` from `three/addons/utils/SkeletonUtils.js`.
2. Always bind and add the root clone as the scene object (`obj = clone`). Do NOT reparent a sub-node out of the clone hierarchy — doing so breaks ancestor transforms and skinned rigs.
3. If `sub` is set: find `clone.getObjectByName(sub)`. If found, use recursive visibility approach:
   - First, set `visible = false` on all objects in the clone hierarchy: `clone.traverse(n => n.visible = false)`.
   - Then, set `visible = true` on the sub-node and all its descendants: `subNode.traverse(n => n.visible = true)`.
   - Then, walk up from the sub-node to the clone root, setting each ancestor `visible = true` (so the sub-node is reachable in the scene graph): `for (let p = subNode.parent; p; p = p.parent) p.visible = true`.
   - This guarantees exactly the sub-tree is visible regardless of nesting depth — ancestors are visible (structurally required) but their own geometry/materials don't render because Three.js only renders objects where `visible === true`, and sibling branches remain hidden.
   - If `sub` lookup fails, warn and keep full clone visible (fallback).
4. Apply `Transform3D` if present; set `userData.entityId`.
5. Call `binding.set(entity, clone)`. This directly replaces any existing binding (including a mesh from `MeshRenderer`). `ThreeBinding.set()` removes the old object from the scene and adds the new one.
6. Mark slot `active`.

Removal/disposal:

1. On `getRemoved("ModelRenderer")`, handled by the model-removal cleanup pass (step 2) which calls `binding.delete(entity)`.
2. Request system handles ref release when slot is deleted.
3. Source GLTF disposal occurs only when `refCount` reaches zero in manager.

Failure/retry contract:

- Failed slots stay failed (no auto-retry).
- Retry flow: external caller invokes `assetRequestSystem.retryFailed(key)`, which internally calls `assetManager.invalidate(key)` and then broadcasts re-request to all matching failed slots, transitioning them to pending with correct refcounts.

## `MeshRenderer` skip behavior in `renderSyncSystem`

When `ModelRenderer` is present on an entity, `renderSyncSystem` skips mesh creation for that entity. This is a **single guard check** — no deferred sets, no tracking state, no cross-system commands:

1. On `getAdded("MeshRenderer")`, check `world.hasComponent(entity, "ModelRenderer" as any)`. If true, skip mesh creation (do nothing). The model owns the binding slot.
2. On `getRemoved("MeshRenderer")`, only call `binding.delete(entity)` if the entity does NOT have `ModelRenderer`. If `ModelRenderer` is present, skip (the model owns the binding).
3. If `ModelRenderer` is later removed from an entity that still has `MeshRenderer`, `renderSyncSystem` can pick up `MeshRenderer` on the next `getUpdated` or via a component touch.

**Why this stays simple**: `renderSyncSystem` never issues `removeComponent("ModelRenderer")`, and `modelResolveSystem` never issues `removeComponent("MeshRenderer")`. No system removes the other's component. The binding map is a "last writer wins" slot, and `renderSyncSystem` simply defers to the model system by checking component presence. This unidirectional relationship is what eliminates the deferred sets, multi-frame conflict resolution, and cross-system state sharing from the original design.

## Light system refactor (`src/engine/rendering/lights.ts`)

Lights are decoupled from `ThreeBinding` entirely. The light system owns its own maps and adds/removes lights from the scene directly.

Internal state (per light type):

```ts
const directionalLights = new Map<EntityId, THREE.DirectionalLight>();
const pointLights = new Map<EntityId, THREE.PointLight>();
const spotLights = new Map<EntityId, THREE.SpotLight>();
const ambientLights = new Map<EntityId, THREE.AmbientLight>();
```

Factory signature:

```ts
export function createLightSyncSystem(scene: THREE.Scene): System<R>
```

The system receives the `THREE.Scene` directly (not `ThreeBinding`) to add/remove lights.

Per-frame logic for each light type (using `DirectionalLight` as example):

1. **`getAdded` pass**: Create `THREE.DirectionalLight`, configure from component data, add to `scene`, store in `directionalLights` map. Create helper if `showHelper` is true.
2. **`getUpdated` pass**: Update existing light properties from component data. Toggle helper on/off.
3. **`getRemoved` pass**: Retrieve light from `directionalLights` map, remove from scene, dispose helper if present, delete from map.

Apply the same pattern to `PointLight`, `SpotLight`, and `AmbientLight`.

## No `flushChanges()` coupling for asset completion

No manager-facing `flushChanges()` step is needed. Completion sets are drained by resolve system (`drainReady`, `drainFailed`) and are safe across frame boundaries.

## Frame-by-frame flows

### Basic async flow

```text
Frame N:   ModelRenderer added -> requestSystem calls request("glb", uri), creates slot pending version=1
Between:   loader resolves -> manager entry ready, key appended to ready set
Frame N+K: requestSystem no change (slot already exists)
           resolveSystem drainReady gets key, pending slot matches key -> instantiate clone -> slot active
```

### Cached-hit same-frame instantiation (Path B)

```text
Frame N:   ModelRenderer added with uri=robot.glb (already cached as ready)
           requestSystem calls request("glb", robot.glb), creates slot pending version=1
           resolveSystem Path B scans pending slots, peek(key) returns ready entry -> instantiate clone same frame -> slot active
```

### Stale request flow (key change)

```text
Frame N:   uri=a.glb requested (version=1, slot pending)
Frame N+1: update to uri=b.glb
           requestSystem releases a, requests b, bumps version=2, marks pending clearOnPending=true
           resolveSystem pre-clear removes old model immediately (same frame)
Later:     a completes -> no matching slot key (slot now has b's key), ignored
Later:     b completes -> requestSystem no change (slot exists)
           resolveSystem drainReady gets b's key, slot matches -> instantiates b
```

### Same-key `sub` switch

```text
Frame N:   active slot key=glb::robot.glb sub=arm
Frame N+1: update sub=head (same key)
           requestSystem sets pending + clearOnPending=true (no new request)
           resolveSystem pre-clear removes old clone (same frame)
           resolveSystem Path B sees key already ready -> instantiates head clone (same frame)
```

### Mesh->model handoff (single frame)

```text
Frame N:   entity has MeshRenderer visible (mesh bound via ThreeBinding)
Frame N+K: model becomes ready
           requestSystem no change (slot already pending)
           resolveSystem sees slot ready, calls binding.set(entity, clone)
           binding.set() removes old mesh from scene, adds model clone -> slot active (single frame)
```

### Empty URI add then update flow

```text
Frame N:   ModelRenderer added with uri="" -> requestSystem skips, no slot created
Frame N+K: update to uri=model.glb
           requestSystem sees getUpdated, no existing slot -> treats as fresh add
           validates loader, calls request(), creates slot with pending
           (proceeds exactly like getAdded with non-empty URI)
Frame N+K: (same frame) resolveSystem sees component update (via getUpdated), URI is non-empty, no special handling
           (if model is cached, Path B instantiates same frame; otherwise waits for async load)
```

### Empty URI update flow (non-empty → empty)

```text
Frame N:   active slot key=glb::model.glb, model bound
Frame N+K: update to uri=""
           requestSystem adds slotKey to "empty URI cleanup" set
           requestSystem empty-URI cleanup pass: releases key, deletes slot
           resolveSystem empty-URI cleanup pass: sees getUpdated(ModelRenderer) with empty URI, calls binding.delete(entity)
```

### Light + model coexistence (no conflict)

```text
Frame N:   entity has DirectionalLight (managed by lightSyncSystem's own map)
Frame N+K: ModelRenderer's model becomes ready
           lightSyncSystem runs (no changes — light is independent)
           resolveSystem sees slot ready, calls binding.set(entity, clone) -> model in scene
           Light remains in scene via lightSyncSystem's own map — both coexist
```

### Component-presence gate preventing stale instantiation

```text
Frame N:   entity has ModelRenderer, slot pending
Frame N+1: user/system removes ModelRenderer
           resolveSystem runs, model becomes ready (Path A or B), checks component-presence gate
           gate fails: world.hasComponent(entity, "ModelRenderer") returns false
           resolveSystem skips entity entirely (no instantiation, slot remains pending)
Frame N+2: requestSystem sees getRemoved(ModelRenderer), releases key, deletes slot (cleanup)
```

## Implementation Order

1. `src/engine/assets/types.ts`
2. `src/engine/assets/manager.ts`
3. `src/engine/assets/index.ts`
4. `src/engine/assets/manager.test.ts`
5. `src/engine/rendering/loaders/gltf-loader.ts`
6. `src/engine/rendering/loaders/index.ts`
7. `src/engine/rendering/components.ts` (add `ModelRenderer`, `SpotLight`, `LoadingState`, `renderingResources`)
8. `src/engine/rendering/systems.ts`
9. `src/engine/rendering/lights.ts` (refactor to use own light maps, decouple from ThreeBinding)
10. `src/engine/rendering/asset-sync.test.ts`
11. `src/engine/rendering/index.ts`
12. Run `pnpm typecheck && pnpm test:run`

## Testing Strategy

### Test helper pattern

Integration tests must use per-system command buffer flush to match scheduler behavior. The test `frame()` helper should look like:

```ts
function frame(fn?: () => void) {
  world.beginFrame();
  fn?.();
  // Each system gets its own CommandBuffer, flushed immediately after
  const cmds1 = new CommandBuffer(world);
  lightSync(world, 0, cmds1);
  cmds1.flush();

  const cmds2 = new CommandBuffer(world);
  assetRequestSystem(world, 0, cmds2);
  cmds2.flush();  // slot updates visible to resolve

  const cmds3 = new CommandBuffer(world);
  modelResolveSystem(world, 0, cmds3);
  cmds3.flush();

  const cmds4 = new CommandBuffer(world);
  renderSync(world, 0, cmds4);
  cmds4.flush();

  const cmds5 = new CommandBuffer(world);
  transformSync(world, 0, cmds5);
  cmds5.flush();

  world.endFrame();
}
```

This mirrors what `Scheduler.runFrame()` does: fresh `CommandBuffer` per system, flush after each.

### AssetManager unit tests (`src/engine/assets/manager.test.ts`)

- dedup request/refcount behavior
- ready transition + drainReady clears on second call
- failed transition + drainFailed clears on second call
- release to zero disposes and evicts
- release during load handles stale settle safely (asset disposed, not added to ready set)
- release then re-request same key before old promise settles: old settle sees entry identity mismatch, disposes old asset, does not corrupt new entry
- hasLoader returns true/false correctly
- request with unregistered type throws
- release on missing key is no-op
- invalidate(error) removes cache entry and allows retry
- invalidate(missing/non-error) no-op
- stats counts
- same URI different `sub` => one load/cache entry
- same URI different options => one load/cache entry

### Integration tests (`src/engine/rendering/asset-sync.test.ts`)

- cached hit instantiates same frame (Path B)
- pending load instantiates after completion (Path A)
- remove `ModelRenderer` detaches bound object and releases ref via request-system slot deletion
- update new URI: old released, new requested, old model cleared immediately, stale completion ignored
- update same URI+same sub: no-op, no ref leak
- update same URI+different sub: no new load, old clone replaced with selected new sub-node
- missing `sub` name falls back to root clone (warn path)
- two entities same URI: one load, two clones
- entity destroyed while loading: no leak, release once
- transform applied to instantiated model
- empty URI on add: skipped, no slot created
- empty URI on add then non-empty URI on update: treated as fresh add, slot created correctly
- URI updated from non-empty to empty: old ref released, slot deleted, model cleared from scene (via resolve empty-URI cleanup pass)
- unsupported asset type (no loader registered): slot created as failed, warning logged, no frame-time throw
- unsupported asset type slot counted in LoadingState.failed
- unsupported asset type with later loader registration: component touch triggers branch D re-check, slot transitions to pending
- unsupported asset type slot: component touch without loader registration remains no-op (branch D)
- LoadingState pending/ready/failed totals computed from slot map (not manager stats)
- mesh->model handoff: model instantiation replaces mesh binding in single frame via `binding.set()`
- MeshRenderer skipped when ModelRenderer present: no mesh created, no binding conflict
- both renderers added same frame: model wins binding slot, mesh skipped
- entity with light + model: both coexist (light in own map, model in binding)
- failed load sets slot failed and increments LoadingState.failed
- failed slot removed/destroyed releases exactly once (release skipped for key="" slots)
- broadcast retry via `retryFailed(key)` transitions all matching failed slots to pending with correct refcounts
- clone detach is per-entity; source asset disposed only when last ref released
- remove + destroy same frame still releases once
- schema walker rejects components with multiple AssetRef fields
- sub selection uses recursive visibility: all objects hidden, then sub-tree + ancestors set visible
- deep sub selection: sibling branches at intermediate levels remain hidden
- component-presence gate prevents stale instantiation when ModelRenderer removed before resolve runs
- component-presence gate allows instantiation when ModelRenderer still present
