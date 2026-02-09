import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fc from "fast-check";
import * as THREE from "three";
import { createWorld } from "../ecs/world";
import { CommandBuffer } from "../ecs/commands";
import { renderingRegistry, renderingResources } from "./components";
import { ThreeBinding } from "./binding";
import {
  createAssetRequestSystem,
  createAssetResolveSystem,
  AssetResolver,
  createModelHandler,
  createRenderSyncSystem,
  createTransformSyncSystem,
} from "./systems";
import type { SlotEntry } from "./systems";
import { createLightSyncSystem } from "./lights";
import { AssetManager } from "../assets/manager";
import type { AssetLoader } from "../assets/types";

const GLB_TYPE = "glb";
const ALT_TYPE = "vox";
const ENTITY_SLOTS = 3;
const URIS = ["a.glb", "b.glb", "c.glb"] as const;
const ALL_TYPES = [GLB_TYPE, ALT_TYPE] as const;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

function createMockGltf(name = "root") {
  const scene = new THREE.Group();
  scene.name = name;
  const arm = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  arm.name = "arm";
  const head = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  head.name = "head";
  scene.add(arm);
  scene.add(head);
  return { gltf: { scene } };
}

function createQueueLoader() {
  const pending = new Map<string, Pending[]>();
  const disposed: unknown[] = [];
  const loader: AssetLoader<unknown> = {
    load(uri: string) {
      return new Promise((resolve, reject) => {
        const queue = pending.get(uri) ?? [];
        queue.push({ resolve, reject });
        pending.set(uri, queue);
      });
    },
    dispose(asset: unknown) {
      disposed.push(asset);
    },
  };

  function resolveNext(uri: string, asset: unknown): boolean {
    const queue = pending.get(uri);
    if (!queue || queue.length === 0) return false;
    queue.shift()!.resolve(asset);
    if (queue.length === 0) pending.delete(uri);
    return true;
  }

  function rejectNext(uri: string, error: Error): boolean {
    const queue = pending.get(uri);
    if (!queue || queue.length === 0) return false;
    queue.shift()!.reject(error);
    if (queue.length === 0) pending.delete(uri);
    return true;
  }

  return { loader, pending, disposed, resolveNext, rejectNext };
}

async function tick() {
  await new Promise((r) => setTimeout(r, 0));
}

type Setup = ReturnType<typeof setup>;

function setup() {
  const world = createWorld(renderingRegistry, {
    resources: renderingResources,
  });
  const binding = new ThreeBinding(world);
  const scene = binding.scene;
  const assetManager = new AssetManager();
  const slots = new Map<string, SlotEntry>();
  const mock = createQueueLoader();

  assetManager.registerLoader(GLB_TYPE, mock.loader);

  const lightSync = createLightSyncSystem(scene, binding);
  const assetRequest = createAssetRequestSystem(assetManager, slots, renderingRegistry);
  const resolver = new AssetResolver();
  resolver.register(createModelHandler() as any);
  const modelResolve = createAssetResolveSystem(assetManager, binding as any, slots, resolver as any);
  const renderSync = createRenderSyncSystem(binding);
  const transformSync = createTransformSyncSystem(binding);

  function frame(fn?: () => void) {
    world.beginFrame();
    fn?.();

    const cmds1 = new CommandBuffer(world);
    lightSync(world, 0, cmds1);
    cmds1.flush();

    const cmds2 = new CommandBuffer(world);
    assetRequest(world as any, 0, cmds2 as any);
    cmds2.flush();

    const cmds3 = new CommandBuffer(world);
    modelResolve(world as any, 0, cmds3 as any);
    cmds3.flush();

    const cmds4 = new CommandBuffer(world);
    renderSync(world, 0, cmds4);
    cmds4.flush();

    const cmds5 = new CommandBuffer(world);
    transformSync(world, 0, cmds5);
    cmds5.flush();

    world.endFrame();
  }

  const entities = Array.from({ length: ENTITY_SLOTS }, () => world.createEntity());
  frame();

  return {
    world,
    binding,
    scene,
    assetManager,
    slots,
    mock,
    frame,
    assetRequest,
    entities,
  };
}

type AssetRefInput = {
  type: string;
  uri: string;
  sub?: string;
  options?: Record<string, unknown>;
};

type Action =
  | { kind: "set"; entityIndex: number; ref: AssetRefInput }
  | { kind: "mutate"; entityIndex: number; ref: AssetRefInput }
  | { kind: "remove"; entityIndex: number }
  | { kind: "destroy"; entityIndex: number }
  | { kind: "multiWrite"; entityIndex: number; first: AssetRefInput; second: AssetRefInput }
  | { kind: "retry"; type: string; uri: string }
  | { kind: "registerAltLoader" }
  | { kind: "settleOk"; uri: string }
  | { kind: "settleFail"; uri: string }
  | { kind: "frameOnly" };

function toModelVisual(ref: AssetRefInput) {
  return {
    asset: {
      kind: "asset",
      type: ref.type,
      uri: ref.uri,
      sub: ref.sub,
      options: ref.options,
    },
  };
}

function countBindingEntries(binding: ThreeBinding<any>): number {
  let n = 0;
  binding.forEach(() => {
    n++;
  });
  return n;
}

function assertCrossSystemInvariants(
  ctx: Setup,
  perSlotLastVersion: Map<string, number>,
) {
  const { world, binding, scene, assetManager, slots, entities } = ctx;

  // Slot-state sanity + per-slot monotonic version while slot exists.
  for (const [sk, slot] of slots) {
    const prev = perSlotLastVersion.get(sk);
    if (prev !== undefined) {
      expect(slot.version).toBeGreaterThanOrEqual(prev);
    }
    perSlotLastVersion.set(sk, slot.version);

    const entity = Number(sk.split(":")[0]);
    expect(world.isAlive(entity)).toBe(true);
    expect(world.hasComponent(entity, "ModelVisual" as any)).toBe(true);

    if (slot.key === "") {
      expect(slot.status).toBe("failed");
    }
    if (slot.status === "active") {
      expect(binding.has(entity)).toBe(true);
    }
    if (slot.status === "failed" && slot.key !== "") {
      expect(assetManager.peek(slot.key)?.status).toBe("error");
    }
  }

  // Reset version history for deleted slots.
  for (const sk of perSlotLastVersion.keys()) {
    if (!slots.has(sk)) perSlotLastVersion.delete(sk);
  }

  // No bound object without VisualRenderer in this test setup.
  for (const entity of entities) {
    const hasModel = world.hasComponent(entity, "ModelVisual" as any);
    if (!hasModel) {
      expect(binding.has(entity)).toBe(false);
    }
  }

  // Ref-slot conservation for all known keys.
  const expectedRefCount = new Map<string, number>();
  for (const slot of slots.values()) {
    if (slot.key === "") continue;
    expectedRefCount.set(slot.key, (expectedRefCount.get(slot.key) ?? 0) + 1);
  }

  for (const type of ALL_TYPES) {
    for (const uri of URIS) {
      const key = AssetManager.cacheKey(type, uri);
      const expected = expectedRefCount.get(key) ?? 0;
      const entry = assetManager.peek(key);
      if (expected === 0) {
        expect(entry).toBeUndefined();
      } else {
        expect(entry, `missing manager entry for ${key}`).toBeDefined();
        expect(entry!.refCount).toBe(expected);
      }
    }
  }

  // LoadingState is derived from slots.
  const ls = (world as any).getResource("LoadingState");
  expect(ls.total).toBe(ls.pending + ls.ready + ls.failed);
  expect(ls.total).toBe(slots.size);

  let pending = 0;
  let ready = 0;
  let failed = 0;
  for (const slot of slots.values()) {
    if (slot.status === "pending") pending++;
    else if (slot.status === "active") ready++;
    else failed++;
  }
  // LoadingState is sampled before modelResolve transitions in the same frame.
  // So ready/failed can be behind and pending can be ahead by one frame.
  expect(ls.pending).toBeGreaterThanOrEqual(pending);
  expect(ls.ready).toBeLessThanOrEqual(ready);
  expect(ls.failed).toBeLessThanOrEqual(failed);

  // Binding protocol: at most one scene object per entity id.
  const sceneObjectsPerEntity = new Map<number, number>();
  scene.traverse((obj) => {
    const entityId = obj.userData?.entityId;
    if (typeof entityId === "number") {
      sceneObjectsPerEntity.set(
        entityId,
        (sceneObjectsPerEntity.get(entityId) ?? 0) + 1,
      );
    }
  });
  for (const entity of entities) {
    expect(sceneObjectsPerEntity.get(entity) ?? 0).toBeLessThanOrEqual(1);
  }

  // Internal consistency on manager stats.
  const stats = assetManager.getStats();
  expect(stats.total).toBe(stats.loading + stats.ready + stats.error);

  // In this setup, binding size cannot exceed live VisualRenderer count.
  let modelCount = 0;
  for (const entity of entities) {
    if (world.hasComponent(entity, "ModelVisual" as any)) modelCount++;
  }
  expect(countBindingEntries(binding)).toBeLessThanOrEqual(modelCount);
}

async function applyAction(ctx: Setup, action: Action) {
  const { world, frame, entities, mock, assetRequest, assetManager } = ctx;
  const entity = (index: number) => entities[index];

  switch (action.kind) {
    case "set":
      frame(() => {
        world.setComponent(entity(action.entityIndex), "ModelVisual" as any, toModelVisual(action.ref));
      });
      break;

    case "mutate":
      frame(() => {
        const e = entity(action.entityIndex);
        if (!world.hasComponent(e, "ModelVisual" as any)) return;
        const mr = world.getMut(e, "ModelVisual" as any) as any;
        mr.asset = toModelVisual(action.ref).asset;
      });
      break;

    case "remove":
      frame(() => {
        const e = entity(action.entityIndex);
        if (world.hasComponent(e, "ModelVisual" as any)) {
          world.removeComponent(e, "ModelVisual" as any);
        }
      });
      break;

    case "multiWrite":
      frame(() => {
        const e = entity(action.entityIndex);
        world.setComponent(e, "ModelVisual" as any, toModelVisual(action.first));
        const mr = world.getMut(e, "ModelVisual" as any) as any;
        if (mr) mr.asset = toModelVisual(action.second).asset;
      });
      break;

    case "destroy":
      frame(() => {
        world.destroyEntity(entity(action.entityIndex));
      });
      // Replace with a fresh entity so the slot stays usable.
      entities[action.entityIndex] = world.createEntity();
      frame();
      break;

    case "retry":
      frame(() => {
        assetRequest.retryFailed(AssetManager.cacheKey(action.type, action.uri));
      });
      break;

    case "registerAltLoader":
      if (!assetManager.hasLoader(ALT_TYPE)) {
        assetManager.registerLoader(ALT_TYPE, mock.loader);
      }
      frame();
      break;

    case "settleOk":
      mock.resolveNext(action.uri, createMockGltf(`asset:${action.uri}`));
      await tick();
      frame();
      break;

    case "settleFail":
      mock.rejectNext(action.uri, new Error(`fail:${action.uri}`));
      await tick();
      frame();
      break;

    case "frameOnly":
      frame();
      break;
  }
}

const entityIndexArb = fc.integer({ min: 0, max: ENTITY_SLOTS - 1 });
const nonEmptyUriArb = fc.constantFrom(...URIS);
const uriArb = fc.oneof(fc.constant(""), nonEmptyUriArb);
const typeArb = fc.constantFrom(...ALL_TYPES);
const subArb = fc.option(fc.constantFrom("arm", "head", "missing"), { nil: undefined });
const optionsArb = fc.option(
  fc.record({
    quality: fc.constantFrom("low", "high"),
    mipmaps: fc.boolean(),
  }),
  { nil: undefined },
);

const refArb = fc.record({
  type: typeArb,
  uri: uriArb,
  sub: subArb,
  options: optionsArb,
});

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({
    kind: fc.constant("set"),
    entityIndex: entityIndexArb,
    ref: refArb,
  }),
  fc.record({
    kind: fc.constant("mutate"),
    entityIndex: entityIndexArb,
    ref: refArb,
  }),
  fc.record({
    kind: fc.constant("multiWrite"),
    entityIndex: entityIndexArb,
    first: refArb,
    second: refArb,
  }),
  fc.record({
    kind: fc.constant("remove"),
    entityIndex: entityIndexArb,
  }),
  fc.record({
    kind: fc.constant("destroy"),
    entityIndex: entityIndexArb,
  }),
  fc.record({
    kind: fc.constant("retry"),
    type: typeArb,
    uri: nonEmptyUriArb,
  }),
  fc.record({
    kind: fc.constant("settleOk"),
    uri: nonEmptyUriArb,
  }),
  fc.record({
    kind: fc.constant("settleFail"),
    uri: nonEmptyUriArb,
  }),
  fc.constant({ kind: "registerAltLoader" }),
  fc.constant({ kind: "frameOnly" }),
);

describe("Asset sync (property-based)", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("preserves cross-system slot/ref/binding/loading invariants under random frame sequences", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 80 }), async (actions) => {
        const ctx = setup();
        const versionHistory = new Map<string, number>();

        assertCrossSystemInvariants(ctx, versionHistory);
        for (const action of actions) {
          await applyAction(ctx, action);
          assertCrossSystemInvariants(ctx, versionHistory);
        }
      }),
      {
        numRuns: 100,
      },
    );
  }, 90_000);
});
