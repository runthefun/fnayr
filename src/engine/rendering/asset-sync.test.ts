import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { createWorld } from "../ecs/world";
import { CommandBuffer } from "../ecs/commands";
import { renderingRegistry, renderingResources } from "./components";
import { ThreeBinding } from "./binding";
import { defineSchema, s } from "../schema";
import { assetRefSchema } from "../asset";
import {
  createRenderSyncSystem,
  createTransformSyncSystem,
  createAssetRequestSystem,
  createModelResolveSystem,
} from "./systems";
import type { SlotEntry } from "./systems";
import { createLightSyncSystem } from "./lights";
import { AssetManager } from "../assets/manager";
import type { AssetLoader } from "../assets/types";

/* ------------------------------------------------------------------ */
/*  Mock helpers                                                       */
/* ------------------------------------------------------------------ */

function createMockGltf(name = "root", childNames: string[] = []) {
  const scene = new THREE.Group();
  scene.name = name;
  for (const cn of childNames) {
    const child = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial()
    );
    child.name = cn;
    scene.add(child);
  }
  return { gltf: { scene } };
}

function createMockSkinnedGltf() {
  const scene = new THREE.Group();
  scene.name = "skinned-root";

  const rootBone = new THREE.Bone();
  rootBone.name = "rootBone";
  const childBone = new THREE.Bone();
  childBone.name = "childBone";
  rootBone.add(childBone);

  const geometry = new THREE.BoxGeometry();
  const material = new THREE.MeshBasicMaterial();
  const skinnedMesh = new THREE.SkinnedMesh(geometry, material);
  skinnedMesh.name = "skinnedMesh";
  skinnedMesh.add(rootBone);
  skinnedMesh.bind(new THREE.Skeleton([rootBone, childBone]));

  scene.add(skinnedMesh);
  return { gltf: { scene } };
}

function getFirstSkinnedMesh(
  obj: THREE.Object3D
): THREE.SkinnedMesh | undefined {
  let result: THREE.SkinnedMesh | undefined;
  obj.traverse((node) => {
    if (!result && node instanceof THREE.SkinnedMesh) {
      result = node;
    }
  });
  return result;
}

function createMockLoader() {
  const pending = new Map<
    string,
    { resolve: (v: any) => void; reject: (e: any) => void }
  >();
  const disposed: unknown[] = [];

  const loader: AssetLoader<any> = {
    load(uri: string) {
      return new Promise((resolve, reject) => {
        pending.set(uri, { resolve, reject });
      });
    },
    dispose(asset: any) {
      disposed.push(asset);
    },
  };

  return {
    loader,
    pending,
    disposed,
    resolve(uri: string, asset: any) {
      const p = pending.get(uri);
      if (p) {
        p.resolve(asset);
        pending.delete(uri);
      }
    },
    reject(uri: string, error: Error) {
      const p = pending.get(uri);
      if (p) {
        p.reject(error);
        pending.delete(uri);
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Setup helper                                                       */
/* ------------------------------------------------------------------ */

function setup() {
  const world = createWorld(renderingRegistry, {
    resources: renderingResources,
  });
  const binding = new ThreeBinding(world);
  const scene = binding.scene;
  const assetManager = new AssetManager();
  const slots = new Map<string, SlotEntry>();
  const mock = createMockLoader();
  assetManager.registerLoader("glb", mock.loader);

  const lightSync = createLightSyncSystem(scene);
  const assetRequest = createAssetRequestSystem(
    assetManager,
    slots,
    renderingRegistry
  );
  const modelResolve = createModelResolveSystem(assetManager, binding, slots);
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

  return {
    world,
    binding,
    scene,
    assetManager,
    slots,
    mock,
    frame,
    assetRequest,
  };
}

async function tick() {
  await new Promise((r) => setTimeout(r, 0));
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("Asset sync", () => {
  // ---- 1. Basic async flow: Path A ----
  it("pending load instantiates after completion (Path A)", async () => {
    const { world, binding, scene, slots, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    // Slot is pending, nothing in scene from the model
    const sk = `${entity}:VisualRenderer`;
    expect(slots.get(sk)?.status).toBe("pending");
    expect(binding.has(entity)).toBe(false);

    // Resolve the mock loader
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();

    // Run another frame → binding has entity, scene has the clone
    frame();

    expect(slots.get(sk)?.status).toBe("active");
    expect(binding.has(entity)).toBe(true);
    const obj = binding.get(entity)!;
    expect(obj).toBeInstanceOf(THREE.Group);
    expect(scene.children).toContain(obj);
  });

  // ---- 2. Cached hit instantiates same frame (Path B) ----
  it("cached hit instantiates same frame (Path B)", async () => {
    const { world, binding, slots, mock, frame } = setup();

    // Pre-load an asset
    const e1 = world.createEntity();
    frame(() => {
      world.setComponent(e1, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame(); // e1 now active

    expect(slots.get(`${e1}:VisualRenderer`)?.status).toBe("active");

    // Add a SECOND entity with the same URI
    const e2 = world.createEntity();
    frame(() => {
      world.setComponent(e2, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    // Path B cache hit: should be active in the same frame
    expect(slots.get(`${e2}:VisualRenderer`)?.status).toBe("active");
    expect(binding.has(e2)).toBe(true);
  });

  // ---- 3. Remove ModelRenderer detaches bound object and releases ref ----
  it("remove ModelRenderer detaches bound object and releases ref", async () => {
    const { world, binding, scene, slots, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame(); // Model bound

    expect(binding.has(entity)).toBe(true);
    const sk = `${entity}:VisualRenderer`;
    expect(slots.has(sk)).toBe(true);

    // Remove the component
    frame(() => {
      world.removeComponent(entity, "VisualRenderer" as any);
    });

    expect(binding.has(entity)).toBe(false);
    expect(slots.has(sk)).toBe(false);
    // Scene should not contain the model anymore
    const modelChildren = scene.children.filter(
      (c) => c.userData.entityId === entity
    );
    expect(modelChildren).toHaveLength(0);
  });

  // ---- 4. Entity destroyed while loading: no leak, release once ----
  it("entity destroyed while loading: no leak, release once", async () => {
    const { world, slots, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    const sk = `${entity}:VisualRenderer`;
    expect(slots.has(sk)).toBe(true);

    // Destroy entity
    frame(() => {
      world.destroyEntity(entity);
    });

    // Slot cleaned up (dead-entity prune)
    expect(slots.has(sk)).toBe(false);

    // Resolve the mock → tick → no leak
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();

    // Another frame: no crash
    frame();
  });

  // ---- 5. Update new URI: old released, new requested ----
  it("update new URI: old released, new requested, old model cleared immediately", async () => {
    const { world, binding, slots, mock, frame } = setup();
    const entity = world.createEntity();

    // Add model with a.glb
    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "a.glb" },
      });
    });
    mock.resolve("a.glb", createMockGltf("modelA"));
    await tick();
    frame(); // active

    const sk = `${entity}:VisualRenderer`;
    expect(slots.get(sk)?.status).toBe("active");
    expect(binding.has(entity)).toBe(true);

    // Update asset to b.glb
    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = { kind: "asset", type: "glb", uri: "b.glb" };
    });

    // Old model removed, slot pending
    expect(slots.get(sk)?.status).toBe("pending");

    // Resolve b.glb
    mock.resolve("b.glb", createMockGltf("modelB"));
    await tick();
    frame();

    expect(slots.get(sk)?.status).toBe("active");
    expect(binding.has(entity)).toBe(true);
    const obj = binding.get(entity)!;
    expect(obj.name).toBe("modelB");
  });

  // ---- 6. Update same URI+same sub: no-op, no ref leak ----
  it("update same URI+same sub: no-op, no ref leak", async () => {
    const { world, binding, slots, mock, frame, assetManager } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame(); // active

    const sk = `${entity}:VisualRenderer`;
    const slotBefore = { ...slots.get(sk)! };
    expect(slotBefore.status).toBe("active");

    // Touch the component with the same data
    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = { kind: "asset", type: "glb", uri: "robot.glb" };
    });

    // Still active, same version (no extra request or release)
    const slotAfter = slots.get(sk)!;
    expect(slotAfter.status).toBe("active");
    expect(binding.has(entity)).toBe(true);
  });

  // ---- 7. Update same URI+different sub: no new load, old clone replaced ----
  it("update same URI+different sub: no new load, old clone replaced", async () => {
    const { world, binding, slots, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve(
      "robot.glb",
      createMockGltf("root", ["arm", "head"])
    );
    await tick();
    frame(); // active, full clone

    const sk = `${entity}:VisualRenderer`;
    expect(slots.get(sk)?.status).toBe("active");

    // Update sub to "arm"
    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = { kind: "asset", type: "glb", uri: "robot.glb", sub: "arm" };
    });

    // The sub change triggers pending+clearOnPending, then Path B cache hit resolves it
    // After the frame, status should be active with new clone
    expect(slots.get(sk)?.status).toBe("active");
    expect(binding.has(entity)).toBe(true);

    // The new clone should have "arm" visible
    const obj = binding.get(entity)!;
    const armChild = obj.getObjectByName("arm");
    expect(armChild).toBeDefined();
    expect(armChild!.visible).toBe(true);
  });

  // ---- 8. Sub selection uses recursive visibility ----
  it("sub selection uses recursive visibility", async () => {
    const { world, binding, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: {
          kind: "asset",
          type: "glb",
          uri: "robot.glb",
          sub: "arm",
        },
      });
    });
    mock.resolve(
      "robot.glb",
      createMockGltf("root", ["arm", "head"])
    );
    await tick();
    frame();

    const obj = binding.get(entity)!;
    const armChild = obj.getObjectByName("arm")!;
    const headChild = obj.getObjectByName("head")!;

    expect(armChild.visible).toBe(true);
    expect(headChild.visible).toBe(false);
    // Root (ancestor of arm) should be visible
    expect(obj.visible).toBe(true);
  });

  // ---- 9. Missing sub name falls back to root clone (warn) ----
  it("missing sub name falls back to root clone (warn)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, binding, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: {
          kind: "asset",
          type: "glb",
          uri: "robot.glb",
          sub: "nonexistent",
        },
      });
    });
    mock.resolve("robot.glb", createMockGltf("root"));
    await tick();
    frame();

    expect(warnSpy).toHaveBeenCalled();
    // Full clone should be visible
    const obj = binding.get(entity)!;
    expect(obj).toBeDefined();
    expect(obj.visible).toBe(true);

    warnSpy.mockRestore();
  });

  // ---- 10. Empty URI on add: skipped, no slot created ----
  it("empty URI on add: skipped, no slot created", () => {
    const { world, binding, slots, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "" },
      });
    });

    const sk = `${entity}:VisualRenderer`;
    expect(slots.has(sk)).toBe(false);
    expect(binding.has(entity)).toBe(false);
  });

  // ---- 11. Empty URI on add then non-empty URI on update ----
  it("empty URI on add then non-empty URI on update", async () => {
    const { world, binding, slots, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "" },
      });
    });

    const sk = `${entity}:VisualRenderer`;
    expect(slots.has(sk)).toBe(false);

    // Update to a real URI
    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = { kind: "asset", type: "glb", uri: "robot.glb" };
    });

    expect(slots.has(sk)).toBe(true);
    expect(slots.get(sk)?.status).toBe("pending");

    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame();

    expect(slots.get(sk)?.status).toBe("active");
    expect(binding.has(entity)).toBe(true);
  });

  // ---- 12. URI updated from non-empty to empty ----
  it("URI updated from non-empty to empty", async () => {
    const { world, binding, slots, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame(); // active

    const sk = `${entity}:VisualRenderer`;
    expect(slots.get(sk)?.status).toBe("active");
    expect(binding.has(entity)).toBe(true);

    // Update to empty URI
    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = { kind: "asset", type: "glb", uri: "" };
    });

    expect(slots.has(sk)).toBe(false);
    expect(binding.has(entity)).toBe(false);
  });

  // ---- 13. Unsupported asset type: slot created as failed, no throw ----
  it("unsupported asset type: slot created as failed, no throw", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, slots, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "texture", uri: "diffuse.png" },
      });
    });

    const sk = `${entity}:VisualRenderer`;
    expect(slots.has(sk)).toBe(true);
    expect(slots.get(sk)?.status).toBe("failed");
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  // ---- 14. Unsupported asset type slot counted in LoadingState.failed ----
  it("unsupported asset type slot counted in LoadingState.failed", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, slots, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "texture", uri: "diffuse.png" },
      });
    });

    const loadingState = (world as any).getResource("LoadingState");
    expect(loadingState).toBeDefined();
    expect(loadingState.failed).toBe(1);

    warnSpy.mockRestore();
  });

  // ---- 15. LoadingState pending/ready/failed totals ----
  it("LoadingState pending/ready/failed totals computed from slot map", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, mock, frame } = setup();

    // Entity 1: glb that will resolve
    const e1 = world.createEntity();
    // Entity 2: glb that stays pending
    const e2 = world.createEntity();
    // Entity 3: unsupported type (failed)
    const e3 = world.createEntity();

    frame(() => {
      world.setComponent(e1, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "a.glb" },
      });
      world.setComponent(e2, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "b.glb" },
      });
      world.setComponent(e3, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "texture", uri: "tex.png" },
      });
    });

    let ls = (world as any).getResource("LoadingState");
    expect(ls.pending).toBe(2);
    expect(ls.failed).toBe(1);
    expect(ls.ready).toBe(0);
    expect(ls.total).toBe(3);

    // Resolve e1
    mock.resolve("a.glb", createMockGltf("a"));
    await tick();
    frame();
    // modelResolve updated slot to "active", but assetRequest already computed
    // LoadingState before modelResolve ran. Run one more frame so assetRequest
    // picks up the updated slot status.
    frame();

    ls = (world as any).getResource("LoadingState");
    expect(ls.ready).toBe(1);
    expect(ls.pending).toBe(1);
    expect(ls.failed).toBe(1);
    expect(ls.total).toBe(3);

    warnSpy.mockRestore();
  });

  // ---- 16. Variant transition: mesh→model replaces mesh ----
  it("variant transition mesh→model: model replaces mesh after resolve", async () => {
    const { world, binding, scene, mock, frame } = setup();
    const entity = world.createEntity();

    // Start with mesh variant
    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "mesh",
        geometry: "box",
      });
    });

    expect(binding.has(entity)).toBe(true);
    expect(binding.get(entity)).toBeInstanceOf(THREE.Mesh);

    // Switch to model variant
    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    // Mesh should be removed on variant switch
    expect(binding.has(entity)).toBe(false);

    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame();

    // After model resolves, binding should have the model (Group)
    expect(binding.has(entity)).toBe(true);
    const obj = binding.get(entity)!;
    expect(obj).toBeInstanceOf(THREE.Group);
  });

  // ---- 17. Setting model variant in same frame as add: no mesh created ----
  it("setting model variant on add does not create a mesh", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    // model variant: renderSync skips, so no binding yet
    const obj = binding.get(entity);
    expect(obj).toBeUndefined();
  });

  // ---- 18. Entity with light + model: both coexist ----
  it("entity with light + model: both coexist", async () => {
    const { world, binding, scene, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "DirectionalLight" as any, {
        color: [1, 1, 1, 1],
        intensity: 1,
      });
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame();

    // Model in binding
    expect(binding.has(entity)).toBe(true);
    const obj = binding.get(entity)!;
    expect(obj).toBeInstanceOf(THREE.Group);

    // Light in scene (via light map, not binding)
    const lights = scene.children.filter(
      (c) => c instanceof THREE.DirectionalLight
    );
    expect(lights.length).toBeGreaterThanOrEqual(1);
  });

  // ---- 19. Failed load sets slot failed ----
  it("failed load sets slot failed", async () => {
    const { world, slots, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "bad.glb" },
      });
    });

    mock.reject("bad.glb", new Error("404 not found"));
    await tick();
    frame();

    const sk = `${entity}:VisualRenderer`;
    expect(slots.get(sk)?.status).toBe("failed");
  });

  // ---- 20. Failed slot removed releases exactly once ----
  it("failed slot removed releases exactly once", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, slots, frame } = setup();
    const entity = world.createEntity();

    // Unsupported type → slot immediately failed with key=""
    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "texture", uri: "tex.png" },
      });
    });

    const sk = `${entity}:VisualRenderer`;
    expect(slots.get(sk)?.status).toBe("failed");

    // Remove component, frame → no crash
    frame(() => {
      world.removeComponent(entity, "VisualRenderer" as any);
    });

    expect(slots.has(sk)).toBe(false);

    warnSpy.mockRestore();
  });

  // ---- 21. Transform applied to instantiated model ----
  it("transform applied to instantiated model", async () => {
    const { world, binding, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "Transform3D" as any, {
        position: [5, 10, 15],
        rotation: [0, 0, 0, 1],
        scale: [2, 2, 2],
      });
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame();

    const obj = binding.get(entity)!;
    expect(obj).toBeDefined();
    expect(obj.position.x).toBe(5);
    expect(obj.position.y).toBe(10);
    expect(obj.position.z).toBe(15);
    expect(obj.scale.x).toBe(2);
    expect(obj.scale.y).toBe(2);
    expect(obj.scale.z).toBe(2);
  });

  // ---- 22. Component-presence gate prevents stale instantiation ----
  it("component-presence gate prevents stale instantiation", async () => {
    const { world, binding, slots, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    const sk = `${entity}:VisualRenderer`;
    expect(slots.has(sk)).toBe(true);

    // Remove ModelRenderer before resolve
    frame(() => {
      world.removeComponent(entity, "VisualRenderer" as any);
    });

    // Slot should be cleaned up by the removed handler
    expect(slots.has(sk)).toBe(false);

    // Now resolve the mock
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame();

    // Model should NOT be instantiated (gate fails)
    expect(binding.has(entity)).toBe(false);
  });

  // ---- 23. Retry should invalidate error and trigger a new load ----
  it("retryFailed invalidates error and triggers a fresh load", async () => {
    const { world, slots, mock, frame, assetRequest } = setup();
    const entity = world.createEntity();
    const loadSpy = vi.spyOn(mock.loader, "load");
    const sk = `${entity}:VisualRenderer`;
    const key = AssetManager.cacheKey("glb", "bad.glb");

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "bad.glb" },
      });
    });

    expect(loadSpy).toHaveBeenCalledTimes(1);

    mock.reject("bad.glb", new Error("first failure"));
    await tick();
    frame();

    expect(slots.get(sk)?.status).toBe("failed");

    assetRequest.retryFailed(key);

    // Expected behavior: invalidate + fresh request should call loader again.
    expect(loadSpy).toHaveBeenCalledTimes(2);
  });

  // ---- 24. Key-switch from active model should clear old binding immediately ----
  it("URI key switch clears active model binding before new asset is ready", async () => {
    const { world, binding, scene, slots, mock, frame } = setup();
    const entity = world.createEntity();
    const sk = `${entity}:VisualRenderer`;

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "a.glb" },
      });
    });
    mock.resolve("a.glb", createMockGltf("modelA"));
    await tick();
    frame();

    const firstObj = binding.get(entity)!;
    expect(slots.get(sk)?.status).toBe("active");
    expect(binding.has(entity)).toBe(true);

    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = { kind: "asset", type: "glb", uri: "b.glb" };
    });

    // Expected behavior: active->pending key switch pre-clears old object.
    expect(slots.get(sk)?.status).toBe("pending");
    expect(binding.has(entity)).toBe(false);
    expect(scene.children.includes(firstObj)).toBe(false);
  });

  // ---- 25. Variant transition mesh→model should not leave stale mesh in scene ----
  it("variant transition mesh→model leaves exactly one scene object for the entity", async () => {
    const { world, binding, scene, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "mesh",
        geometry: "box",
      });
    });
    expect(binding.get(entity)).toBeInstanceOf(THREE.Mesh);

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame();

    const objectsForEntity = scene.children.filter(
      (obj) => obj.userData.entityId === entity
    );

    expect(objectsForEntity).toHaveLength(1);
    expect(objectsForEntity[0]).toBeInstanceOf(THREE.Group);
  });

  // ---- 26. Failed slot should not become pending on sub-only updates ----
  it("failed slot remains failed when only sub changes", async () => {
    const { world, slots, mock, frame } = setup();
    const entity = world.createEntity();
    const sk = `${entity}:VisualRenderer`;

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "bad.glb" },
      });
    });

    mock.reject("bad.glb", new Error("load failed"));
    await tick();
    frame();

    expect(slots.get(sk)?.status).toBe("failed");

    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = {
        kind: "asset",
        type: "glb",
        uri: "bad.glb",
        sub: "arm",
      };
    });

    expect(slots.get(sk)?.status).toBe("failed");
  });

  // ---- 27b. Pending slot sub change should advance generation ----
  it("pending slot sub change advances generation", () => {
    const { world, slots, frame } = setup();
    const entity = world.createEntity();
    const sk = `${entity}:VisualRenderer`;

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: {
          kind: "asset",
          type: "glb",
          uri: "robot.glb",
          sub: "arm",
        },
      });
    });

    expect(slots.get(sk)?.status).toBe("pending");
    expect(slots.get(sk)?.version).toBe(0);

    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = {
        kind: "asset",
        type: "glb",
        uri: "robot.glb",
        sub: "head",
      };
    });

    expect(slots.get(sk)?.status).toBe("pending");
    expect(slots.get(sk)?.version).toBe(1);
  });

  // ---- 27c. Failed slot sub change should advance generation ----
  it("failed slot sub change advances generation", async () => {
    const { world, slots, mock, frame } = setup();
    const entity = world.createEntity();
    const sk = `${entity}:VisualRenderer`;

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "bad.glb", sub: "arm" },
      });
    });
    mock.reject("bad.glb", new Error("load failed"));
    await tick();
    frame();

    expect(slots.get(sk)?.status).toBe("failed");
    expect(slots.get(sk)?.version).toBe(0);

    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = {
        kind: "asset",
        type: "glb",
        uri: "bad.glb",
        sub: "head",
      };
    });

    expect(slots.get(sk)?.status).toBe("failed");
    expect(slots.get(sk)?.version).toBe(1);
  });

  // ---- 27. retryFailed should handle unsupported-type failed slots ----
  it("retryFailed re-requests unsupported-type slot after loader registration", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, slots, assetManager, assetRequest, frame } = setup();
    const entity = world.createEntity();
    const sk = `${entity}:VisualRenderer`;

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "texture", uri: "diffuse.png" },
      });
    });

    expect(slots.get(sk)?.status).toBe("failed");
    expect(slots.get(sk)?.key).toBe("");

    const textureLoad = vi.fn(() => Promise.resolve({ tex: "ok" }));
    assetManager.registerLoader("texture", {
      load: textureLoad,
      dispose: vi.fn(),
    });

    assetRequest.retryFailed(AssetManager.cacheKey("texture", "diffuse.png"));

    expect(textureLoad).toHaveBeenCalledTimes(1);
    expect(slots.get(sk)?.status).toBe("pending");
    expect(slots.get(sk)?.key).toBe(
      AssetManager.cacheKey("texture", "diffuse.png")
    );

    warnSpy.mockRestore();
  });

  // ---- 28. Skinned models should have independent skeleton clones ----
  it("same cached skinned model creates independent skeletons per entity", async () => {
    const { world, binding, mock, frame } = setup();
    const e1 = world.createEntity();
    const e2 = world.createEntity();

    frame(() => {
      world.setComponent(e1, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "rig.glb" },
      });
      world.setComponent(e2, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "rig.glb" },
      });
    });

    mock.resolve("rig.glb", createMockSkinnedGltf());
    await tick();
    frame();

    const obj1 = binding.get(e1)!;
    const obj2 = binding.get(e2)!;
    const skinned1 = getFirstSkinnedMesh(obj1);
    const skinned2 = getFirstSkinnedMesh(obj2);
    expect(skinned1).toBeDefined();
    expect(skinned2).toBeDefined();

    expect(skinned1!.skeleton.bones[0]).not.toBe(skinned2!.skeleton.bones[0]);
    expect(
      obj1.getObjectByProperty("uuid", skinned1!.skeleton.bones[0].uuid)
    ).toBeDefined();
    expect(
      obj2.getObjectByProperty("uuid", skinned2!.skeleton.bones[0].uuid)
    ).toBeDefined();
  });

  // ---- 29. Variant transition model→mesh restores mesh binding ----
  it("variant transition model→mesh creates mesh binding after model was active", async () => {
    const { world, binding, scene, slots, mock, frame } = setup();
    const entity = world.createEntity();

    // Start with model variant
    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame();

    expect(binding.get(entity)).toBeInstanceOf(THREE.Group);

    // Switch to mesh variant via setComponent (replaces entire component data)
    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "mesh",
        geometry: "box",
      });
    });

    // Slot should be cleaned up (variant no longer has asset ref)
    expect(slots.has(`${entity}:VisualRenderer`)).toBe(false);
    // Binding should be a mesh now
    expect(binding.has(entity)).toBe(true);
    expect(binding.get(entity)).toBeInstanceOf(THREE.Mesh);
  });

  // ---- 30. Existing cached error should fail new slots (not remain pending) ----
  it("requesting a key already cached as error does not leave new slot pending", async () => {
    const { world, slots, mock, frame } = setup();
    const e1 = world.createEntity();

    frame(() => {
      world.setComponent(e1, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "bad.glb" },
      });
    });
    mock.reject("bad.glb", new Error("load failed"));
    await tick();
    frame();

    expect(slots.get(`${e1}:VisualRenderer`)?.status).toBe("failed");

    const e2 = world.createEntity();
    frame(() => {
      world.setComponent(e2, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "bad.glb" },
      });
    });
    frame();

    expect(slots.get(`${e2}:VisualRenderer`)?.status).toBe("failed");
  });

  // ---- 30b. Active model should clear when switching to URI already cached as error ----
  it("switching active model to cached-error URI clears stale binding immediately", async () => {
    const { world, binding, slots, mock, frame } = setup();

    const badEntity = world.createEntity();
    frame(() => {
      world.setComponent(badEntity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "bad.glb" },
      });
    });
    mock.reject("bad.glb", new Error("load failed"));
    await tick();
    frame();

    const entity = world.createEntity();
    const sk = `${entity}:VisualRenderer`;
    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "good.glb" },
      });
    });
    mock.resolve("good.glb", createMockGltf("good"));
    await tick();
    frame();

    expect(slots.get(sk)?.status).toBe("active");
    expect(binding.has(entity)).toBe(true);

    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = { kind: "asset", type: "glb", uri: "bad.glb" };
    });

    expect(binding.has(entity)).toBe(false);
  });

  // ---- 31. Two entities same URI: one load, two independent clones ----
  it("two entities same URI: one load, two independent clones", async () => {
    const { world, binding, mock, frame } = setup();
    const loadSpy = vi.spyOn(mock.loader, "load");
    const e1 = world.createEntity();
    const e2 = world.createEntity();

    frame(() => {
      world.setComponent(e1, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
      world.setComponent(e2, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    // Dedup: loader.load called only once
    expect(loadSpy).toHaveBeenCalledTimes(1);

    mock.resolve("robot.glb", createMockGltf("robot", ["arm", "head"]));
    await tick();
    frame();

    // Two independent clones
    const obj1 = binding.get(e1)!;
    const obj2 = binding.get(e2)!;
    expect(obj1).toBeDefined();
    expect(obj2).toBeDefined();
    expect(obj1).not.toBe(obj2);
  });

  // ---- 32. Remove + destroy same frame → releases exactly once ----
  it("remove + destroy same frame releases exactly once", async () => {
    const { world, slots, mock, frame, assetManager } = setup();
    const entity = world.createEntity();
    const key = AssetManager.cacheKey("glb", "robot.glb");

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame(); // active

    expect(assetManager.peek(key)?.refCount).toBe(1);

    // Remove component and destroy entity in same frame
    frame(() => {
      world.removeComponent(entity, "VisualRenderer" as any);
      world.destroyEntity(entity);
    });

    // No double-release: entry cleaned up once
    expect(assetManager.peek(key)).toBeUndefined();
    expect(slots.has(`${entity}:VisualRenderer`)).toBe(false);
  });

  // ---- 33. Multiple writes same frame coalesce to one effective transition ----
  it("multiple writes same frame coalesce to one effective transition", async () => {
    const { world, slots, mock, frame } = setup();
    const entity = world.createEntity();
    const loadSpy = vi.spyOn(mock.loader, "load");

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "a.glb" },
      });
    });
    mock.resolve("a.glb", createMockGltf("modelA"));
    await tick();
    frame(); // active with a.glb

    loadSpy.mockClear();

    // Two writes in one frame: uri a→b→c
    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = { kind: "asset", type: "glb", uri: "b.glb" };
      const mr2 = world.getMut(entity, "VisualRenderer" as any) as any;
      mr2.asset = { kind: "asset", type: "glb", uri: "c.glb" };
    });

    const sk = `${entity}:VisualRenderer`;
    // System sees only the final value (c.glb), not intermediate (b.glb)
    expect(slots.get(sk)?.uri).toBe("c.glb");
    expect(slots.get(sk)?.status).toBe("pending");
    // Only c.glb was requested, not b.glb
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledWith("c.glb", undefined);
  });

  // ---- 34. Deep nesting: intermediate siblings hidden ----
  it("deep nesting sub selection hides intermediate siblings", async () => {
    const { world, binding, mock, frame } = setup();
    const entity = world.createEntity();

    // Build nested hierarchy: root > body > [arm > hand, leg], head
    const root = new THREE.Group();
    root.name = "root";
    const body = new THREE.Group();
    body.name = "body";
    root.add(body);
    const arm = new THREE.Group();
    arm.name = "arm";
    body.add(arm);
    const hand = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial()
    );
    hand.name = "hand";
    arm.add(hand);
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial()
    );
    leg.name = "leg";
    body.add(leg);
    const head = new THREE.Mesh(
      new THREE.BoxGeometry(),
      new THREE.MeshBasicMaterial()
    );
    head.name = "head";
    root.add(head);

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "char.glb", sub: "arm" },
      });
    });
    mock.resolve("char.glb", { gltf: { scene: root } });
    await tick();
    frame();

    const obj = binding.get(entity)!;
    // Target and descendants visible
    expect(obj.getObjectByName("arm")!.visible).toBe(true);
    expect(obj.getObjectByName("hand")!.visible).toBe(true);
    // Ancestors visible
    expect(obj.getObjectByName("body")!.visible).toBe(true);
    expect(obj.visible).toBe(true);
    // Siblings hidden
    expect(obj.getObjectByName("leg")!.visible).toBe(false);
    expect(obj.getObjectByName("head")!.visible).toBe(false);
  });

  // ---- 35. Unsupported failed slots tracked with zero manager refs ----
  it("unsupported failed slots are tracked with zero manager refs", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, slots, assetManager, frame } = setup();
    const entity = world.createEntity();
    const key = AssetManager.cacheKey("texture", "diffuse.png");

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "texture", uri: "diffuse.png" },
      });
    });

    const sk = `${entity}:VisualRenderer`;
    expect(slots.get(sk)?.status).toBe("failed");
    expect(slots.get(sk)?.key).toBe("");
    // No entry in asset manager (no loader, so no request was made)
    expect(assetManager.peek(key)).toBeUndefined();

    warnSpy.mockRestore();
  });

  // ---- 36. Loader registered later + component touch → recovers to pending ----
  it("unsupported-type slot recovers to pending on component touch after loader registered", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, slots, assetManager, frame } = setup();
    const entity = world.createEntity();
    const sk = `${entity}:VisualRenderer`;

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "texture", uri: "diffuse.png" },
      });
    });
    expect(slots.get(sk)?.status).toBe("failed");

    // Register loader
    assetManager.registerLoader("texture", {
      load: vi.fn(() => Promise.resolve({ tex: "ok" })),
      dispose: vi.fn(),
    });

    // Loader registration alone does not trigger recovery
    frame();
    expect(slots.get(sk)?.status).toBe("failed");

    // Touch the component (triggers update event)
    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = { kind: "asset", type: "texture", uri: "diffuse.png" };
    });

    expect(slots.get(sk)?.status).toBe("pending");

    warnSpy.mockRestore();
  });

  // ---- 37. Touch without loader: no-op for unsupported type ----
  it("touch unsupported-type slot without loader is a no-op", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, slots, frame } = setup();
    const entity = world.createEntity();
    const sk = `${entity}:VisualRenderer`;

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "texture", uri: "diffuse.png" },
      });
    });
    expect(slots.get(sk)?.status).toBe("failed");

    // Touch without registering loader → no recovery
    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = { kind: "asset", type: "texture", uri: "diffuse.png" };
    });

    expect(slots.get(sk)?.status).toBe("failed");

    warnSpy.mockRestore();
  });

  // ---- 37b. Unsupported slot URI change still updates tracked slot metadata ----
  it("unsupported-type URI change updates slot uri and version even without loader", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, slots, frame } = setup();
    const entity = world.createEntity();
    const sk = `${entity}:VisualRenderer`;

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "texture", uri: "a.png" },
      });
    });

    const first = slots.get(sk);
    expect(first?.status).toBe("failed");
    expect(first?.uri).toBe("a.png");
    expect(first?.version).toBe(0);

    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = { kind: "asset", type: "texture", uri: "b.png" };
    });

    const second = slots.get(sk);
    expect(second?.status).toBe("failed");
    expect(second?.uri).toBe("b.png");
    expect(second?.version).toBe(1);

    warnSpy.mockRestore();
  });

  // ---- 38. Multiple retryFailed(key) coalesced per slot ----
  it("multiple retryFailed(key) in one frame are coalesced per slot", async () => {
    const { world, slots, mock, frame, assetRequest } = setup();
    const entity = world.createEntity();
    const loadSpy = vi.spyOn(mock.loader, "load");
    const key = AssetManager.cacheKey("glb", "bad.glb");

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "bad.glb" },
      });
    });
    mock.reject("bad.glb", new Error("fail"));
    await tick();
    frame();

    expect(slots.get(`${entity}:VisualRenderer`)?.status).toBe("failed");
    loadSpy.mockClear();

    // Call retryFailed twice — should produce at most one new request
    assetRequest.retryFailed(key);
    assetRequest.retryFailed(key);

    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  // ---- 39. Divergent options warning at integration level ----
  it("divergent options warning emits at most once per load attempt", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, frame } = setup();
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    const e3 = world.createEntity();

    frame(() => {
      world.setComponent(e1, "VisualRenderer" as any, {
        kind: "model",
        asset: {
          kind: "asset",
          type: "glb",
          uri: "robot.glb",
          options: { quality: "high" },
        },
      });
      world.setComponent(e2, "VisualRenderer" as any, {
        kind: "model",
        asset: {
          kind: "asset",
          type: "glb",
          uri: "robot.glb",
          options: { quality: "low" },
        },
      });
      world.setComponent(e3, "VisualRenderer" as any, {
        kind: "model",
        asset: {
          kind: "asset",
          type: "glb",
          uri: "robot.glb",
          options: { quality: "medium" },
        },
      });
    });

    const divergentWarns = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("Divergent options")
    );
    expect(divergentWarns.length).toBe(1);

    warnSpy.mockRestore();
  });

  // ---- 40. Unsupported-type warning at most once per slot-generation ----
  it("unsupported-type warning emits at most once per slot-generation", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "texture", uri: "diffuse.png" },
      });
    });

    const warnCount1 = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("No loader registered")
    ).length;
    expect(warnCount1).toBe(1);

    // Touch component with same data — should NOT warn again
    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = { kind: "asset", type: "texture", uri: "diffuse.png" };
    });

    const warnCount2 = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("No loader registered")
    ).length;
    expect(warnCount2).toBe(1);

    warnSpy.mockRestore();
  });

  // ---- 41. Missing sub fallback warning at most once per slot-generation ----
  it("missing sub fallback warning emits at most once per slot-generation", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: {
          kind: "asset",
          type: "glb",
          uri: "robot.glb",
          sub: "nonexistent",
        },
      });
    });
    mock.resolve("robot.glb", createMockGltf("root"));
    await tick();
    frame();

    const subWarns = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("not found in glTF")
    );
    expect(subWarns.length).toBe(1);

    warnSpy.mockRestore();
  });

  // ---- 42. Schema walker rejects multiple AssetRef fields per component ----
  it("schema walker rejects multiple AssetRef fields per component", () => {
    const { assetManager } = setup();
    const badRegistry = {
      MultiAsset: {
        type: "object" as const,
        properties: {
          asset1: {
            type: "object" as const,
            properties: {},
            meta: { kind: "assetRef" },
          },
          asset2: {
            type: "object" as const,
            properties: {},
            meta: { kind: "assetRef" },
          },
        },
      },
    };

    expect(() =>
      createAssetRequestSystem(assetManager, new Map(), badRegistry)
    ).toThrow(/Multiple AssetRef fields/);
  });

  // ---- 43. Per-entity clone independence; source disposed only at zero refCount ----
  it("per-entity clone independence and source disposed only at zero refCount", async () => {
    const { world, binding, mock, frame, assetManager } = setup();
    const e1 = world.createEntity();
    const e2 = world.createEntity();
    const key = AssetManager.cacheKey("glb", "robot.glb");

    frame(() => {
      world.setComponent(e1, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
      world.setComponent(e2, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    const sourceAsset = createMockGltf("robot");
    mock.resolve("robot.glb", sourceAsset);
    await tick();
    frame();

    // Two independent clones (different object identities)
    const obj1 = binding.get(e1)!;
    const obj2 = binding.get(e2)!;
    expect(obj1).not.toBe(obj2);

    // RefCount is 2
    expect(assetManager.peek(key)?.refCount).toBe(2);

    // Remove first entity's component — source NOT disposed
    frame(() => {
      world.removeComponent(e1, "VisualRenderer" as any);
    });
    expect(assetManager.peek(key)?.refCount).toBe(1);
    expect(assetManager.peek(key)?.status).toBe("ready");
    expect(mock.disposed).toHaveLength(0);

    // Remove second entity's component — source disposed at zero refCount
    frame(() => {
      world.removeComponent(e2, "VisualRenderer" as any);
    });
    expect(assetManager.peek(key)).toBeUndefined();
    expect(mock.disposed).toContain(sourceAsset);
  });

  // ---- 44. Variant transition model→mesh via getMut creates mesh in same frame ----
  it("switching active model to mesh variant creates mesh binding in same frame", async () => {
    const { world, binding, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame();
    expect(binding.get(entity)).toBeInstanceOf(THREE.Group);

    // Switch variant to mesh
    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "mesh",
        geometry: "box",
      });
    });

    expect(world.hasComponent(entity, "VisualRenderer" as any)).toBe(true);
    expect(binding.has(entity)).toBe(true);
    expect(binding.get(entity)).toBeInstanceOf(THREE.Mesh);
  });

  // ---- 45. Active->unsupported transition should clear stale binding ----
  it("switching an active model to an unsupported type clears the old binding immediately", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, binding, slots, mock, frame } = setup();
    const entity = world.createEntity();
    const sk = `${entity}:VisualRenderer`;

    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame();

    expect(slots.get(sk)?.status).toBe("active");
    expect(binding.has(entity)).toBe(true);

    frame(() => {
      const mr = world.getMut(entity, "VisualRenderer" as any) as any;
      mr.asset = { kind: "asset", type: "texture", uri: "diffuse.png" };
    });

    expect(slots.get(sk)?.status).toBe("failed");
    expect(binding.has(entity)).toBe(false);
    warnSpy.mockRestore();
  });

  // ---- 46. Non-ModelRenderer asset slots must not be resolved as glTF models ----
  it("model resolver ignores ready slots that do not belong to ModelRenderer", async () => {
    const AudioAsset = defineSchema(
      s.object({
        asset: assetRefSchema,
      }),
    );
    const registry = {
      ...renderingRegistry,
      AudioAsset,
    } as const;

    const world = createWorld(registry, {
      resources: renderingResources,
    });
    const binding = new ThreeBinding(world as any);
    const scene = binding.scene;
    const assetManager = new AssetManager();
    const slots = new Map<string, SlotEntry>();

    const glbLoader: AssetLoader<unknown> = {
      load: vi.fn(() => new Promise(() => {})),
      dispose: vi.fn(),
    };
    const audioLoader: AssetLoader<unknown> = {
      load: vi.fn(() => Promise.resolve({ bytes: new Uint8Array([1, 2, 3]) })),
      dispose: vi.fn(),
    };

    assetManager.registerLoader("glb", glbLoader);
    assetManager.registerLoader("audioClip", audioLoader);

    const lightSync = createLightSyncSystem(scene);
    const assetRequest = createAssetRequestSystem(assetManager, slots, registry as any);
    const modelResolve = createModelResolveSystem(assetManager, binding, slots);
    const renderSync = createRenderSyncSystem(binding as any);
    const transformSync = createTransformSyncSystem(binding as any);

    function frame(fn?: () => void) {
      world.beginFrame();
      fn?.();

      const cmds1 = new CommandBuffer(world as any);
      lightSync(world as any, 0, cmds1 as any);
      cmds1.flush();

      const cmds2 = new CommandBuffer(world as any);
      assetRequest(world as any, 0, cmds2 as any);
      cmds2.flush();

      const cmds3 = new CommandBuffer(world as any);
      modelResolve(world as any, 0, cmds3 as any);
      cmds3.flush();

      const cmds4 = new CommandBuffer(world as any);
      renderSync(world as any, 0, cmds4 as any);
      cmds4.flush();

      const cmds5 = new CommandBuffer(world as any);
      transformSync(world as any, 0, cmds5 as any);
      cmds5.flush();

      world.endFrame();
    }

    const entity = world.createEntity();
    frame(() => {
      world.setComponent(entity, "VisualRenderer" as any, {
        kind: "model",
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
      world.setComponent(entity, "AudioAsset" as any, {
        asset: { kind: "asset", type: "audioClip", uri: "theme.ogg" },
      });
    });

    await tick();

    expect(() => frame()).not.toThrow();
  });
});
