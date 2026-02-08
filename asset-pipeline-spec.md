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

### 1. Slot state machine
A tracked slot has state ∈ {pending, active, failed} and a monotonically increasing generation counter. Valid transitions: `pending → active` (resolve success), `pending → failed` (resolve failure or unsupported type), `active → pending` (URI/sub change; generation advances), `failed → pending` (retryFailed, URI change, or unsupported-type recovery with loader now registered; generation advances). No other transitions occur — in particular `failed → active` and `active → failed` require passing through `pending`. Generation advances on URI change, sub change, and retry; it never decreases. A component update that changes neither URI nor sub causes no transition and no generation advance. A failed slot does not auto-recover on re-execution or unrelated updates.

### 2. Ref-slot conservation
For any cache key k with a live entry, `peek(k).refCount` equals the number of tracked slots bound to k. Every slot contributes exactly one ref at steady state. All transitions preserve this: creation calls `request()` (+1), destruction calls `release()` (−1), URI change calls `release(old)` then `request(new)`, retry calls `invalidate()` + `request()` with no net change. When a slot is removed (component removal or entity destruction), its ref is released by end of frame. No double-release, no leaked refs.

### 3. Completion safety
Each load attempt produces exactly one terminal event (ready or failed). A completion applies only if the slot's (entity, component, generation) still matches — stale completions are discarded and their assets disposed (mechanism behind AssetManager invariant 5). Per slot-generation, at most one instantiation occurs: the synchronous path (`peek` at system entry) and the async path (`drainReady`) are mutually exclusive per generation. Within a frame, generation advance and clearOnPending precede any completion application. If the component has been removed, forward mutations (instantiation) are discarded; only teardown mutations (clear, release) are permitted.

### 4. Binding protocol
An entity's ThreeBinding holds at most one scene object. `binding.set(entity, obj)` is the sole write path: it removes and disposes the previous object (geometry, materials) before adding the new one — no frame has both present, no orphan scene-graph nodes accumulate. Per frame, at most one system writes to a given entity's binding, enforced by system ordering and the ModelRenderer guard.

### 5. LoadingState
LoadingState is computed once per frame at the end of `assetRequestSystem` from tracked slot counts (not `AssetManager.getStats()`), including slots for unsupported types. `total = pending + ready + failed`, where `ready` counts slots in the `active` state. Downstream slot transitions (by `modelResolveSystem`) are reflected next frame.

### 6. System isolation
Systems own disjoint resource domains: lights use per-type maps, models/meshes use ThreeBinding. No system removes another system's component.

### 7. Identity
Cache key identity is `(asset.type, asset.uri)` — `sub` and `options` do not affect it. At most one slot exists per `(entity, componentType, assetFieldPath)`. Each entity receives its own clone via `SkeletonUtils.clone()`; no two entities share a clone object identity. The set of asset-bearing components is fixed at system creation time.

### 8. Resilience
Unsupported asset types are tracked as failed without throwing. If no ECS changes occurred and no loads settled, re-execution is a no-op. A loader failure for one URI does not affect other in-flight loads. Multiple `retryFailed(key)` calls within the same frame produce at most one new request per failed slot.

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
