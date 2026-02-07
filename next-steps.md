# Next Steps

## Where We Are

The engine kernel is complete: a schema-driven data layer and a full ECS runtime with entities, sparse-set component storage, cached queries, change tracking, deferred commands, a multi-phase scheduler, parent-child hierarchy, frame-buffered events, and JSON serialization. All of it is well-tested (~100+ tests, no gaps) and type-safe end-to-end.

What we don't have yet is anything you can *see*. There's no rendering, no input, no game loop, and no editor. The React shell is an empty scaffold. The codebase is a powerful data engine with no output.

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

## 2. Asset Pipeline & Resource Loading

Once rendering works, you need real content instead of procedural primitives.

- **Asset catalog**: a registry mapping string IDs to URLs + type metadata
- **Async loaders**: GLTF/GLB, textures, audio (Three.js loaders already exist, wrap them)
- **Loading state**: a resource the scheduler can check before running gameplay systems
- **Hot-reload**: file watcher → re-import during dev for fast iteration

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

| Priority | Feature | Why |
|----------|---------|-----|
| **Now** | Rendering bridge | Everything else is more useful once you can see it |
| **Next** | Asset loading | Real meshes/textures instead of colored boxes |
| **Next** | Input system | Makes demos interactive, trivial to build |
| **Then** | Editor UI | The schema system's killer feature — auto-generated panels |
| **Then** | Scene serialization | Save/load, undo/redo, prefabs |
| **Later** | Physics | Needs gameplay to justify it |
| **Later** | WebGPU/TSL | Optimization pass, not a blocker |
