# Next Steps

## Where We Are

The engine kernel is complete: a schema-driven data layer and a full ECS runtime with entities, sparse-set component storage, cached queries, change tracking, deferred commands, a multi-phase scheduler, parent-child hierarchy, frame-buffered events, and JSON serialization. All of it is well-tested (~100+ tests, no gaps) and type-safe end-to-end.

What we don't have yet is anything you can _see_. There's no rendering, no input, no game loop, and no editor. The React shell is an empty scaffold. The codebase is a powerful data engine with no output.

The next steps turn it into a game engine.

---

## 1. Three.js Rendering Bridge (immediate next)

The highest-leverage move. A system that synchronizes ECS component data into a Three.js scene graph each frame.

- **Components**: `Transform3D` (position / quaternion / scale), `MeshRenderer` (geometry type + color)
- **ThreeBinding class**: owns a `Map<EntityId, Object3D>` and a `THREE.Scene`, hooks into destroy listeners for cleanup (same pattern as `Hierarchy`)
- **Render sync system**: uses ECS change tracking (`getAdded` / `getRemoved` / `getUpdated`) to create, update, and remove Three.js objects — no full-scene diff needed
- **Game loop**: `requestAnimationFrame` → `scheduler.runFrame(dt)` → `renderer.render(scene, camera)`
- **Headless tests**: Three.js scene graph objects work in Node.js — verify sync logic in vitest without a browser
- **Browser demo**: a spinning red cube on a green ground plane at `/demo.html`

This is the first milestone that proves the entire pipeline: schema → ECS → Three.js → pixels.

## 2a. Asset Pipeline — Core Loading (immediate after rendering)

Once rendering works, you need real content instead of procedural primitives. This milestone covers the load/dedup/error lifecycle only — enough to get GLTF models on screen.

- **AssetManager**: caching, dedup, refcounting, async→sync bridge via drain APIs
- **GLTF loader**: wraps Three.js `GLTFLoader`, pluggable per-type
- **Request/resolve systems**: generic asset discovery + GLTF-specific scene instantiation
- **ModelRenderer component**: format-agnostic, mutually exclusive with MeshRenderer
- **Loading state resource**: scheduler can gate gameplay on `blockGameplay` flag
- **Error handling**: failed-load drain path, invalidate + retry flow

See [asset-pipeline.md](asset-pipeline.md) for full design.

## 2b. Asset Pipeline — Hot-Reload (deferred)

DX convenience, not a gameplay blocker. Defer until editor workflow demands it.

- **File watcher**: detect changed assets on disk during dev
- **Cache invalidation**: `assetManager.invalidate()` + re-trigger affected slots
- **Partial reload**: swap assets in-place without full page reload
- **Complexity**: must handle reload while systems are running, mid-frame asset swaps, partial load states

Can iterate with full page reloads until this exists. Unlocked by 2a's invalidate/re-request infrastructure.

## 2c. Engine Integration Hardening

Short stabilization pass after rendering + assets, before editor/physics multiply complexity.

- **Leak checks**: verify refCount reaches zero for all asset paths (load, fail, destroy, hot-swap); binding map has no orphaned entries after entity destruction
- **Performance counters**: frame time breakdown by scheduler phase, asset load latency histogram, binding map size, pending/active/failed slot counts
- **CI gates**: `pnpm typecheck && pnpm test:run` in CI; consider adding a basic perf smoke test (N entities spawned/destroyed in < X ms)
- **Regression safety net**: catches latent issues from cross-system coordination (two systems writing to ThreeBinding, async loading with refcounting) before the codebase grows further

## 3. Input System

Cheap to build, immediately makes demos interactive.

- **Polled input resource**: keyboard / mouse / gamepad state captured as an ECS resource each frame (matches the frame-buffered design — no raw event handlers in gameplay code)
- **API**: `isPressed(key)`, `justPressed(key)`, `justReleased(key)`, axis values
- **Scheduler phase**: an `"input"` phase that runs before `"update"`, sampling browser events into the resource

## 4. Editor / Inspector UI

This is where the schema system pays off. Every component is described by a schema, which means you can auto-generate property panels without hand-written UI.

- **Entity list panel**: shows all entities and their components
- **Property inspector**: auto-generates input fields from schemas (`s.number` → slider, `s.enum` → dropdown, `s.object` → nested panel, etc.)
- **Live editing**: inspector writes back to ECS via `getMut`, changes flow through the normal sync system to Three.js
- **React-based**: the React shell finally has a purpose — the editor UI lives there, the 3D viewport is a Three.js canvas beside it

## 5. Scene Serialization Round-Trip

`bridge.ts` handles entities and components but not hierarchy. Extend it so you can save and load full scenes.

- Add parent-child relationships to the JSON format
- Serialize/deserialize resource singletons
- Support prefab references (an entity template you can stamp out multiple times)
- Enables scene files, save/load, and undo/redo

## 6. Physics Integration

Standard choice: **Rapier.js** (Rust-compiled-to-WASM, deterministic, fast).

- `RigidBody` and `Collider` components in ECS
- A physics sync system: ECS transforms → Rapier bodies (write), Rapier simulation → ECS transforms (read-back)
- Runs in a `"physics"` scheduler phase between `"update"` and `"render"`

## 7. WebGPU + TSL Shaders

The vision doc targets Three.js with the WebGPU renderer and TSL for shader authoring. Worth spiking early to confirm the path works.

- Swap `WebGLRenderer` for `WebGPURenderer` (Three.js r175+)
- Author a simple TSL material to validate the shader workflow
- Benchmark against WebGL to establish a performance baseline

---

## Suggested Order

| Priority  | Feature                | Why                                                        |
| --------- | ---------------------- | ---------------------------------------------------------- |
| **Now**   | Rendering bridge       | Everything else is more useful once you can see it         |
| **Next**  | Asset loading (2a)     | Real meshes/textures instead of colored boxes              |
| **Next**  | Integration hardening  | Catch leaks/regressions before complexity multiplies       |
| **Next**  | Input system           | Makes demos interactive, trivial to build                  |
| **Then**  | Editor UI              | The schema system's killer feature — auto-generated panels |
| **Then**  | Scene serialization    | Save/load, undo/redo, prefabs                              |
| **Later** | Asset hot-reload (2b)  | DX convenience, not a gameplay blocker                     |
| **Later** | Physics                | Needs gameplay to justify it                               |
| **Later** | WebGPU/TSL             | Optimization pass, not a blocker                           |
