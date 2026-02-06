# ECS Core Task Plan

This plan defines the runtime ECS core needed to drive simulation and an editor. Each task includes a description, testable success criteria, and explicit dependencies. Tasks are ordered by recommended execution.

## Task T1 — Define Core ECS Types & API Surface

**Description**
Define the core public types and API contracts for the runtime ECS. This includes `EntityId` (with generation for safety), `ComponentType`, `ComponentSchema` registry types, and interfaces for `ComponentStore`, `World`, and `Query` APIs. The goal is to lock a stable API before implementation.

**Depends on**
- None (first task).

**Success criteria**
- New types live in `src/engine/ecs/types.ts` (or similar) and are exported from `src/engine/index.ts`.
- `pnpm typecheck` passes.
- `pnpm test:run` passes (no new tests required for this task).
**Status**: Done

## Task T2 — Entity ID & Lifecycle Manager

**Description**
Implement an `EntityManager` that creates/destroys entities with generation-based IDs to avoid stale references. Provide `create()`, `destroy()`, `isAlive()`, and a way to iterate active entities. Ensure IDs are stable and reusable without ambiguity.

**Depends on**
- T1

**Success criteria**
- Implemented in `src/engine/ecs/entity.ts` and exported.
- Unit tests in `src/engine/ecs/entity.test.ts` cover:
  - New IDs are unique.
  - Destroyed IDs are no longer alive.
  - Reused IDs have incremented generation and old IDs are invalid.
- `pnpm typecheck` and `pnpm test:run` pass.
**Status**: Done

## Task T3 — Sparse Set Component Storage

**Description**
Implement a `SparseSetStore<T>` (or equivalent) for fast add/remove/has/get/iterate by entity. It should support O(1) add/remove and preserve dense arrays for cache-friendly iteration.

**Depends on**
- T1
- T2

**Success criteria**
- Implemented in `src/engine/ecs/storage.ts` and exported.
- Unit tests in `src/engine/ecs/storage.test.ts` cover:
  - add/get/has/remove behavior
  - dense array compaction after removals
  - iterating entities/data in sync
- `pnpm typecheck` and `pnpm test:run` pass.

## Task T4 — World Runtime Core (Entities + Components)

**Description**
Implement `World` that combines `EntityManager` + component stores. Provide:
- `createEntity()` / `destroyEntity()`
- `addComponent(entity, type, data)`
- `removeComponent(entity, type)`
- `getComponent(entity, type)` / `hasComponent(entity, type)`
- Registry-backed component types

Components should be typed per registry and stored in appropriate `SparseSetStore` instances. The world should reject adding components to dead entities.

**Depends on**
- T1
- T2
- T3

**Success criteria**
- Implemented in `src/engine/ecs/world.ts` and exported.
- Unit tests in `src/engine/ecs/world.test.ts` cover:
  - component add/remove/get/has
  - removing entity cleans up components
  - errors or no-ops when accessing dead entities
- `pnpm typecheck` and `pnpm test:run` pass.

## Task T5 — Query System (Include/Exclude)

**Description**
Implement a query API that can iterate entities matching component sets. Support:
- `query([A, B])` (include)
- `query([A], { exclude: [B] })` (exclude)
- Iteration yields entity + component views

This should be efficient (iterate smallest component store first) but correctness is higher priority initially.

**Depends on**
- T4

**Success criteria**
- Implemented in `src/engine/ecs/query.ts` (or integrated into `world.ts`) and exported.
- Unit tests in `src/engine/ecs/query.test.ts` cover:
  - include-only queries
  - include + exclude queries
  - entities created/destroyed during runtime
- `pnpm typecheck` and `pnpm test:run` pass.

## Task T6 — Change Tracking (Added/Removed/Updated)

**Description**
Add per-frame change tracking so systems and the editor can react to diffs. Provide:
- `world.beginFrame()` / `world.endFrame()` or `world.flushChanges()`
- `getAdded(type)`, `getRemoved(type)`, `getUpdated(type)` lists
- Updates tracked when component data is set or replaced

**Depends on**
- T4
- T5

**Success criteria**
- Implemented in `src/engine/ecs/changes.ts` (or `world.ts`), exported.
- Unit tests in `src/engine/ecs/changes.test.ts` cover:
  - added/removed during frame
  - updated detection
  - clearing between frames
- `pnpm typecheck` and `pnpm test:run` pass.

## Task T7 — Runtime <-> JSON World Bridge

**Description**
Bridge runtime `World` with schema-based JSON parse/serialize. Implement helpers:
- `worldFromJson(registry, json, options)` -> runtime world
- `worldToJson(registry, world, options)` -> JSON

This should use `parseWorld` / `serializeWorld` for validation and preserve unknown components when configured.

**Depends on**
- T4
- T6

**Success criteria**
- Implemented in `src/engine/ecs/bridge.ts` and exported.
- Unit tests in `src/engine/ecs/bridge.test.ts` cover:
  - round-trip stability for known components
  - handling unknown components when allowed
  - validation error paths surfaced
- `pnpm typecheck` and `pnpm test:run` pass.

## Task T8 — Minimal System Runner

**Description**
Implement a minimal system runner to execute game logic in order. Provide:
- `System` type: `(world, dt) => void`
- `Scheduler` with `addSystem`, `runFrame(dt)`

This should be deterministic and ready for editor-driven stepping.

**Depends on**
- T4
- T5

**Success criteria**
- Implemented in `src/engine/ecs/systems.ts` and exported.
- Unit tests in `src/engine/ecs/systems.test.ts` cover:
  - systems run in insertion order
  - systems can query and mutate the world
- `pnpm typecheck` and `pnpm test:run` pass.

## Task T9 — Documentation & Examples

**Description**
Add concise usage docs for the ECS runtime (entity creation, component add/remove, queries, change tracking). Include a short example system.

**Depends on**
- T4
- T5
- T6

**Success criteria**
- Added to `README.md` or `docs/ecs-runtime.md`.
- Example code typechecks (if included in tests or a `*.test.ts` sanity check).
- `pnpm typecheck` and `pnpm test:run` pass.
