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

1. **Dedup**: `cacheKey(type, uri)` is the identity. Same type+uri = same cache entry, regardless of `options`.
2. **RefCount accuracy**: `entry.refCount` equals the number of unmatched `request()` calls for that key. Every `request()` increments, every `release()` decrements.
3. **Zero-ref cleanup**: when refCount reaches 0, the asset is disposed and the cache entry is deleted.
4. **No orphan leaks**: if an entry is released while its load is still in-flight, the settled asset is disposed (never silently dropped).
5. **No stale corruption**: if the same key is released and re-requested before the original load settles, the old completion does not mutate the new entry.
6. **Drain-once**: each key appears in at most one `drainReady()` or `drainFailed()` call. Draining clears the set.
7. **Idempotent release**: releasing an unknown/missing key is a no-op.
8. **Invalidate scope**: `invalidate(key)` removes the entry only if its status is `error`. No-op otherwise.
9. **Request precondition**: `request()` throws if no loader is registered for `type`.

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

### Ref balance
Every `request()` made by the request system has exactly one matching `release()`. No double-release, no leaked refs.

### Binding ownership
An entity's ThreeBinding slot has at most one scene object at any time (last writer wins via `binding.set()`).

### Light independence
Lights use their own per-type maps, never ThreeBinding. Models/meshes use ThreeBinding, never light maps. An entity can have both a light and a model/mesh with no conflict.

### No cross-removal
No system removes another system's component. `modelResolveSystem` never removes `MeshRenderer`. `renderSyncSystem` never removes `ModelRenderer`.

### Component-presence safety
No instantiation or binding mutation for an entity that no longer has the relevant component (e.g., `ModelRenderer` removed but async load completes).

### LoadingState accuracy
`LoadingState` reflects the actual count of all tracked asset slots, including slots for unsupported types. It is not derived from `AssetManager.getStats()`.

### No frame-time throws
Unsupported asset types (no loader registered) are handled gracefully. The system must not crash the frame.

### Cleanup completeness
When an entity is destroyed or its asset-bearing component is removed, all associated resources are cleaned up (refs released, bindings cleared) within bounded frames.

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
| Component updated, URI changed | Old ref released, new ref requested. If old was active, old binding cleared immediately (same frame). |
| Component updated, same URI, sub changed | No new load. If was active, re-instantiate from cached asset with new sub (same frame). |
| Component updated, empty → non-empty URI | Treated as fresh add |
| Component updated, non-empty → empty URI | Ref released, tracking removed |
| Component updated, previously unsupported type, loader now registered | Transitions from failed to pending, request issued |
| Component removed | Ref released, tracking removed |
| Entity destroyed | Ref released, tracking removed |

### LoadingState
Updated each frame from tracked slot counts.

### retryFailed(key)
Public method. Invalidates the error entry in the manager, then re-requests for all tracked slots that failed with a matching key. Correct refcounts are maintained.

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
| URI/sub changed (clearOnPending) | Old binding cleared immediately (same frame), before new instantiation |

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
