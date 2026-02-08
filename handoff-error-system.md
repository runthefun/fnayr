# Asset Error Reporting — Design Handoff

## Problem

When an asset fails to load (e.g., Draco-compressed GLB without DRACOLoader), the error is silently swallowed. The `AssetManager` stores the error on the cache entry and the slot gets marked `"failed"`, but:
- Nothing logs to the console
- No UI feedback to the user
- No programmatic way for consumers (editor, game logic) to react

## Fix Already Applied

`GltfAssetLoader` now sets up a `DRACOLoader` with the Google-hosted decoder, so Draco-compressed models load correctly. This was the immediate bug.

## Proposed Error Reporting Design

Two layers: console logging (infrastructure) + error components (ECS-native).

### Layer 1: Console Logging in AssetManager

**File:** `src/engine/assets/manager.ts`, promise rejection handler (~line 89)

Add `console.error` when an asset fails. Simple, always-on, no API changes:

```typescript
(err: unknown) => {
  if (this.cache.get(key) !== capturedEntry) return;
  capturedEntry.status = "error";
  capturedEntry.error = err instanceof Error ? err : new Error(String(err));
  this._justFailed.add(key);
  console.error(`Asset load failed [${key}]:`, capturedEntry.error.message);
},
```

### Layer 2: AssetError Component via Reconciliation System

Model errors as ECS components. This is idiomatic ECS — no new listener API, no special event plumbing.

**New component** (in `src/engine/rendering/components.ts` or a shared location):

```typescript
export const AssetError = defineSchema(
  s.object({
    source: s.string(),   // component type, e.g. "VisualRenderer"
    uri: s.string(),      // the URI that failed
    message: s.string(),  // error message
  })
);
```

**New system** — `createAssetErrorSyncSystem(slots, assetManager)`:

A small declarative system that reconciles error components from slot state each frame:

```
for each slot in slots:
  parse entity ID from slot key
  if slot.status === "failed" && entity has no AssetError:
    peek the asset manager for the error message
    setComponent(entity, "AssetError", { source, uri, message })
  if slot.status !== "failed" && entity has AssetError:
    removeComponent(entity, "AssetError")
```

**Why reconciliation (not events):**
- No drain/event plumbing needed
- Self-healing: retry succeeds → slot goes "active" → error component removed automatically
- Generic: works for any asset-bearing component type, not just VisualRenderer
- Fits ECS patterns — derive component state from authoritative state (slots)

**Why a separate system (not in request/resolve systems):**
- Request system manages request lifecycle (request, track, release)
- Resolve system handles instantiation (clone, add to scene)
- Error reporting is a cross-cutting concern with its own responsibility

### How the Editor Consumes It

No special wiring needed. The editor already reacts to component changes via `onComponentChanged`. The inspector would naturally display `AssetError` as a component on the entity. A toast/banner could query all entities with `AssetError` components.

### System Execution Order

In the RAF loop (`src/editor/setup.ts`):

```
assetRequestSync(...)    // manage slots, request assets
modelResolveSync(...)    // instantiate ready models, mark failed slots
assetErrorSync(...)      // reconcile AssetError components from slot state  ← NEW
```

## Open Questions

- Should `AssetError` live in the rendering registry or a more general location?
- Should the error component include a timestamp or retry count?
- Should there be a UI affordance for retry (button that calls `retryFailed`)?
- For non-entity-scoped errors (global failures), a separate mechanism would be needed
