# Asset Pipeline Spec

## Architecture

```
AssetManager          — cache, dedup, refcount, completion queues (Three-agnostic)
GltfAssetLoader       — type-specific loader (Three.js GLTFLoader wrapper)
assetRequestSystem    — generic: discovers AssetRef fields via schema, issues requests
modelResolveSystem    — GLTF-specific: drains completions, instantiates clones
renderSyncSystem      — mesh-specific: syncs MeshRenderer to binding
lightSyncSystem       — light-specific: owns its own light maps, independent of ThreeBinding
```

### System Ordering

```
1. lightSyncSystem
2. assetRequestSystem
3. modelResolveSystem
4. renderSyncSystem
5. transformSyncSystem
```

Each system's commands are flushed before the next runs.

---

## AssetManager

### API

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

### Invariants

1. **Dedup**: `cacheKey(type, uri)` is the identity. Same type+uri = same cache entry, regardless of `options`. Options are per-URI loader hints (decoder settings, quality), not per-consumer identity. The first request's options are used for the load; subsequent requests reuse the cached entry. If a later request supplies different options for the same key, a warning is logged (divergent options for the same URI is a caller bug).
2. **RefCount accuracy (live attempt)**: for a live cache entry, `entry.refCount` equals the number of current holders of that key in the current load attempt. Every `request()` increments and every matched holder release decrements.
3. **Zero-ref cleanup**: when refCount reaches 0, the asset is disposed and the cache entry is deleted.
4. **No orphan leaks**: if an entry is released while its load is still in-flight, the settled asset is disposed (never silently dropped).
5. **No stale corruption**: if the same key is released and re-requested before the original load settles, the old completion does not mutate the new entry.
6. **Drain-once per attempt**: each key appears in at most one `drainReady()` or `drainFailed()` call per load attempt. Draining clears the set. A key may re-appear in a later drain if `invalidate()` + re-request creates a new load attempt (e.g., via `retryFailed`).
7. **Idempotent release**: releasing an unknown/missing key is a no-op.
8. **Invalidate scope**: `invalidate(key)` removes the entry only if its status is `error`. No-op otherwise.
9. **Invalidate semantics**: invalidating an `error` entry resets that key's load attempt state. A subsequent `request()` starts a fresh entry for the same key.
10. **Request precondition**: `request()` throws if no loader is registered for `type`.

---

## Components

### ModelRenderer

```ts
ModelRenderer = { asset: AssetRef }
// AssetRef = { type, uri, sub?, options? }
```

Format-agnostic. `asset.type` selects resolve behavior.

### SpotLight

```ts
SpotLight = { color, intensity, distance, angle, penumbra, decay, castShadow, showHelper }
```

### LoadingState (resource)

```ts
LoadingState = { pending, ready, failed, total }
```

Worlds running asset systems must be created with `renderingResources`.

---

## Invariants (system-level)

These must hold regardless of implementation strategy.

### Ref balance (slot-lifetime)
Over a slot's lifetime (creation to destruction), exactly one ref is held at steady state. The slot's final cleanup always releases its one outstanding ref. Retry resets the ref via `invalidate()` + re-`request()` without changing the net contribution. No double-release, no leaked refs.

### Binding ownership
An entity's ThreeBinding slot has at most one scene object at any time (last writer wins via `binding.set()`).

### Light independence
Lights use their own per-type maps, never ThreeBinding. Models/meshes use ThreeBinding, never light maps. An entity can have both a light and a model/mesh with no conflict.

### No cross-removal
No system removes another system's component. `modelResolveSystem` never removes `MeshRenderer`. `renderSyncSystem` never removes `ModelRenderer`.

### Component-presence safety
No forward mutation (instantiation, overwrite) of an entity's binding after the relevant component has been removed (e.g., `ModelRenderer` removed but async load completes — completion is discarded). Teardown mutations (clearing binding, releasing refs) as part of removal handling are required, not prohibited.

### LoadingState accuracy
`LoadingState` reflects the actual count of all tracked asset slots as of the most recent `assetRequestSystem` execution, including slots for unsupported types. It is not derived from `AssetManager.getStats()`. Slot transitions by downstream systems (e.g., `modelResolveSystem` moving slots from pending to active) are reflected in the next frame's update.

### LoadingState arithmetic
For every frame: `total = pending + ready + failed`. `ready` is the count of slots in the internal `active` slot state.

### No frame-time throws
Unsupported asset types (no loader registered) are handled gracefully. The system must not crash the frame.

### Cleanup completeness
When an entity is destroyed or its asset-bearing component is removed, all associated resources are cleaned up (refs released, bindings cleared) by the end of the same frame.

### Slot state exclusivity
Each tracked asset slot is in exactly one of `pending`, `active`, or `failed` (or untracked). No slot occupies multiple states simultaneously.

### Slot-refcount conservation
For any cache key with a live entry, `assetManager.peek(key)?.refCount` equals the number of tracked slots currently bound to that key.

### Slot uniqueness
There is at most one tracked slot per `(entity, componentType, assetFieldPath)`.

### Key stability
Slot key identity depends only on `(asset.type, asset.uri)`. Changes to `sub` or `options` do not change the cache key.

### Generation-gated completion
Async completions apply only if the slot's `(entity, component, generation)` still matches. A stale completion (from a previous load attempt or a released slot) is discarded and its asset disposed if no other refs remain. This is the mechanism behind AssetManager invariant 5 (no stale corruption).

### Update-before-completion ordering
For URI/sub updates, slot generation advance and any clear-on-pending binding clear happen before completion application in the same frame.

### Retry idempotence
Multiple `retryFailed(key)` calls within the same frame produce at most one new `request()` per failed slot for that key.

### Retry ref-neutrality
Retrying a failed slot starts a new load attempt for the same key without changing that slot's net steady-state ref contribution (one slot contributes one ref before and after retry).

### Terminal event uniqueness
Each load attempt for a given key produces exactly one terminal event: either `ready` or `failed`, never both, never neither (barring release-before-settle, which is handled by the orphan leak invariant).

### Clone identity isolation
Different entities never share the same instantiated clone object identity. Each entity receives its own independent clone via `SkeletonUtils.clone()`.

### Synchronous resolve path
If `peek(key)?.status === "ready"` at the time modelResolveSystem runs for a newly-pending slot, instantiation occurs in the same frame without waiting for `drainReady()`. `drainReady()` is the async-completion path; the synchronous path checks `peek()` directly.

### Binding scene-graph cleanup
When `binding.set(entity, newObject)` replaces an existing object, or when a binding is cleared, the previous Three.js object is removed from the scene graph and has its resources disposed (geometry, materials). No orphan scene-graph nodes accumulate.

### Monotonic slot generation
A slot's generation counter is monotonically increasing. It advances on URI change, sub change, and retry. It never decreases or resets for a live slot.

### Release-before-request on URI change
When a slot's URI changes from A to B, `release(keyA)` is called before `request(keyB)`. This guarantees that if A and B resolve to the same cache key, the refCount is decremented before being re-incremented, preventing double-counting.

### Failed slot stability
A failed slot remains in the `failed` state indefinitely. It does not auto-retry on subsequent frames, on unrelated component updates, or on system re-execution. Recovery requires one of: (1) an explicit `retryFailed(key)` call, (2) a component update that changes the URI, or (3) for slots that failed due to an unsupported type, a component update when a loader for that type is now registered.

### Single-writer per binding per frame
For any entity, at most one system writes to its ThreeBinding in a given frame. System ordering and the ModelRenderer guard in renderSyncSystem guarantee that modelResolveSystem and renderSyncSystem never both write to the same entity's binding.

### LoadingState update timing
`LoadingState` is updated exactly once per frame, at the end of `assetRequestSystem` execution, after all adds/removes/updates have been processed. Downstream systems and consumers see a consistent snapshot for the remainder of the frame.

### Slot state transitions
The valid slot state transitions are: `pending → active` (resolve success), `pending → failed` (resolve failure or unsupported type), `active → pending` (URI/sub change, new generation), `failed → pending` (retry, URI change, or unsupported-type recovery). No other transitions occur. In particular, `failed → active` and `active → failed` never happen directly — both require passing through `pending`.

### System re-execution idempotence
If no components have been added, removed, or updated, and no async completions have settled since the last frame, running the system pipeline produces no side effects (no requests, no ref changes, no binding mutations, no warnings).

### No double-instantiation per generation
For a given slot at a given generation, at most one clone is instantiated. Neither the synchronous path (`peek`) nor the async path (`drainReady`) can produce a second clone for the same generation.

### Loader failure isolation
A loader's `load()` failure for one URI does not affect, cancel, or delay in-flight loads for other URIs using the same loader instance.

### Same-URI-same-sub update is a no-op
A component update where both `uri` and `sub` are unchanged produces no ref changes, no generation advance, no binding mutation, and no new request — regardless of changes to other fields like `options`.

### Dispose-before-bind ordering
When `binding.set(entity, newObject)` replaces an existing object, the old object is removed from the scene graph and disposed before the new object is added. There is no frame in which both objects exist in the scene simultaneously.

### Schema discovery is static
The set of components with AssetRef fields is determined at `createAssetRequestSystem()` time and does not change for the lifetime of the system. Dynamic schema changes after system creation are not supported.

---

## assetRequestSystem — Observable Behaviors

Factory: `createAssetRequestSystem(assetManager, slots)`

### Schema discovery
- At creation, walks each component schema to find fields marked `schema.meta?.kind === "assetRef"`.
- Recurses into `object` and `optional`. Does not recurse into `array`, `tuple`, `map`, `taggedUnion`.
- Rejects components with multiple AssetRef fields (throws).

### Asset lifecycle

| Event | Behavior |
|---|---|
| Component added, non-empty URI, loader exists | Request issued, asset tracked as pending |
| Component added, non-empty URI, no loader | Asset tracked as failed, warning logged, no request issued |
| Component added, empty URI | Ignored, nothing tracked |
| Component updated, URI changed | Old ref released, new ref requested, slot transitions to pending. Binding clear is handled by resolve/binding systems in the same frame (clearOnPending — always enabled). |
| Component updated, same URI, sub changed | No new load. Slot generation advances so resolve/binding systems can refresh instantiation from cached asset. |
| Component updated, empty → non-empty URI | Treated as fresh add |
| Component updated, non-empty → empty URI | Ref released, tracking removed |
| Component updated (any field write), previously unsupported type, loader now registered | Transitions from failed to pending, request issued. Loader registration alone does not trigger recovery; an explicit component update is required. |
| Component removed | Ref released, tracking removed |
| Entity destroyed | Ref released, tracking removed |

### LoadingState
Updated once at the end of each execution from tracked slot counts (see LoadingState update timing invariant).

### retryFailed(key)
Public method. Invalidates the manager's `error` entry for `key`, then re-requests all tracked failed slots for that key, creating one fresh load attempt. Net slot-to-ref conservation is preserved (one slot, one ref).

---

## modelResolveSystem — Observable Behaviors

Factory: `createModelResolveSystem(assetManager, binding, slots)`

### Resolve lifecycle

| Event | Behavior |
|---|---|
| Asset becomes ready (async completion) | Clone instantiated, bound to entity, slot becomes active |
| Asset already cached ready on first frame | Clone instantiated same frame (no async wait) |
| Asset load fails | Slot marked failed, warning logged |
| ModelRenderer removed | Binding cleared |
| URI updated to empty | Binding cleared |
| Slot generation advanced (URI or sub change) | Detected by comparing slot generation against last-seen generation. Old binding cleared immediately (same frame, clearOnPending), then new clone instantiated from cached asset if available. |

### Instantiation

1. Clone via `SkeletonUtils.clone(gltf.scene)`. Always bind root clone.
2. Sub-selection via visibility: hide entire clone, show sub-node + descendants, show ancestors to root. Siblings hidden.
3. Missing sub name: warn, show full clone.
4. Apply `Transform3D` if present. Set `userData.entityId`.
5. `binding.set(entity, clone)` replaces any existing binding.

### Disposal
- Binding cleared on component removal.
- Source GLTF disposed only when refCount reaches zero in manager (not per-clone).

### Failure
- Failed slots stay failed. No auto-retry.
- Retry via `assetRequestSystem.retryFailed(key)`.

---

## renderSyncSystem — ModelRenderer Guard

- Skip mesh creation for entities that have `ModelRenderer`.
- Skip binding cleanup on `MeshRenderer` removal if entity has `ModelRenderer` (model owns the binding).

---

## lightSyncSystem

Factory: `createLightSyncSystem(scene)`

Owns per-type maps. For each light type (Directional, Point, Spot, Ambient):
- **Added**: create light, configure, add to scene. Create helper if `showHelper`.
- **Updated**: update properties, toggle helper.
- **Removed**: remove from scene, dispose helper.

---

## Expected Flows

### Basic async load
```
Frame N:   ModelRenderer added → request issued, pending
  ...      loader resolves
Frame N+K: resolve instantiates clone → active
```

### Cached hit (same-frame)
```
Frame N:   ModelRenderer added (asset already cached)
           → request issued, pending
           → resolve sees cache hit → instantiates same frame → active
```

### URI change
```
Frame N:   active, uri=A
Frame N+1: update to uri=B
           → old ref released, new requested, old model cleared immediately
  ...      B loads
Frame N+K: resolve instantiates B
           (if A completes late, it is ignored — slot tracks B now)
```

### Sub switch (same URI)
```
Frame N:   active, sub=arm
Frame N+1: update sub=head (same URI)
           → no new load, old clone cleared, new clone with sub=head instantiated same frame
```

### Mesh-to-model handoff
```
Frame N:   entity has MeshRenderer bound
Frame N+K: model ready → binding.set() replaces mesh with model clone (single frame)
```

### Empty URI flows
```
add with uri=""        → nothing tracked
update to uri=model    → treated as fresh add
update from uri=model to uri="" → ref released, binding cleared
```

### Light + model coexistence
```
entity has DirectionalLight (light map) + ModelRenderer (ThreeBinding)
→ both coexist, no conflict
```

---

## Test Cases

### AssetManager

- Dedup: same type+uri → same entry, refCount incremented
- Ready: status transitions, drainReady returns key, second drain empty
- Failed: status transitions, drainFailed returns key, second drain empty
- Release to zero: asset disposed, entry gone
- Release during in-flight: settled asset disposed, not leaked
- Release + re-request before settle: old completion doesn't corrupt new entry
- hasLoader: correct for registered/unregistered
- request unregistered type: throws
- release unknown key: no-op
- invalidate error entry: removed, retry works
- invalidate non-error/missing: no-op
- getStats: correct counts
- Same URI different options: one cache entry

### Integration (ECS + binding)

**Load paths:**
- Cached hit instantiates same frame
- Async load instantiates after completion
- Two entities same URI: one load, two independent clones

**Lifecycle:**
- Remove ModelRenderer → binding cleared, ref released
- Entity destroyed while loading → no leak, release once
- Remove + destroy same frame → releases exactly once

**URI/sub updates:**
- New URI: old released, new requested, old model cleared immediately
- Same URI+same sub: no-op, no ref leak
- Same URI+different sub: no new load, re-instantiate
- Empty URI on add: nothing tracked
- Empty → non-empty: treated as fresh add
- Non-empty → empty: ref released, binding cleared

**Sub selection:**
- Recursive visibility: sub-tree + ancestors visible, siblings hidden
- Deep nesting: intermediate siblings hidden
- Missing sub: fallback to full clone, warning

**Coexistence:**
- Model replaces mesh binding in single frame
- MeshRenderer skipped when ModelRenderer present
- Both added same frame: model wins
- Light + model: independent, both present

**Unsupported type:**
- No loader: slot failed, warning, no throw
- Counted in LoadingState.failed
- Loader registered later + component touch → recovers to pending
- Touch without loader: no-op

**LoadingState:**
- Counts match slot states

**Failure/retry:**
- Failed load → slot failed
- Failed slot cleanup: correct release behavior
- retryFailed: all matching slots transition to pending, correct refcounts

**Guards:**
- Component-presence gate: no instantiation after component removed
- Transform applied to model
- Schema walker rejects multiple AssetRef fields per component
- Per-entity clone independence; source disposed only at zero refCount
