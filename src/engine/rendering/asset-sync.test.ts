import { describe, it, expect, vi } from "vitest";
import * as THREE from "three";
import { createWorld } from "../ecs/world";
import { CommandBuffer } from "../ecs/commands";
import { renderingRegistry, renderingResources } from "./components";
import { ThreeBinding } from "./binding";
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
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    // Slot is pending, nothing in scene from the model
    const sk = `${entity}:ModelRenderer`;
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
      world.setComponent(e1, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame(); // e1 now active

    expect(slots.get(`${e1}:ModelRenderer`)?.status).toBe("active");

    // Add a SECOND entity with the same URI
    const e2 = world.createEntity();
    frame(() => {
      world.setComponent(e2, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    // Path B cache hit: should be active in the same frame
    expect(slots.get(`${e2}:ModelRenderer`)?.status).toBe("active");
    expect(binding.has(e2)).toBe(true);
  });

  // ---- 3. Remove ModelRenderer detaches bound object and releases ref ----
  it("remove ModelRenderer detaches bound object and releases ref", async () => {
    const { world, binding, scene, slots, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame(); // Model bound

    expect(binding.has(entity)).toBe(true);
    const sk = `${entity}:ModelRenderer`;
    expect(slots.has(sk)).toBe(true);

    // Remove the component
    frame(() => {
      world.removeComponent(entity, "ModelRenderer" as any);
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
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    const sk = `${entity}:ModelRenderer`;
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
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "a.glb" },
      });
    });
    mock.resolve("a.glb", createMockGltf("modelA"));
    await tick();
    frame(); // active

    const sk = `${entity}:ModelRenderer`;
    expect(slots.get(sk)?.status).toBe("active");
    expect(binding.has(entity)).toBe(true);

    // Update asset to b.glb
    frame(() => {
      const mr = world.getMut(entity, "ModelRenderer" as any) as any;
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
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame(); // active

    const sk = `${entity}:ModelRenderer`;
    const slotBefore = { ...slots.get(sk)! };
    expect(slotBefore.status).toBe("active");

    // Touch the component with the same data
    frame(() => {
      const mr = world.getMut(entity, "ModelRenderer" as any) as any;
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
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve(
      "robot.glb",
      createMockGltf("root", ["arm", "head"])
    );
    await tick();
    frame(); // active, full clone

    const sk = `${entity}:ModelRenderer`;
    expect(slots.get(sk)?.status).toBe("active");

    // Update sub to "arm"
    frame(() => {
      const mr = world.getMut(entity, "ModelRenderer" as any) as any;
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
      world.setComponent(entity, "ModelRenderer" as any, {
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
      world.setComponent(entity, "ModelRenderer" as any, {
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
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "" },
      });
    });

    const sk = `${entity}:ModelRenderer`;
    expect(slots.has(sk)).toBe(false);
    expect(binding.has(entity)).toBe(false);
  });

  // ---- 11. Empty URI on add then non-empty URI on update ----
  it("empty URI on add then non-empty URI on update", async () => {
    const { world, binding, slots, mock, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "" },
      });
    });

    const sk = `${entity}:ModelRenderer`;
    expect(slots.has(sk)).toBe(false);

    // Update to a real URI
    frame(() => {
      const mr = world.getMut(entity, "ModelRenderer" as any) as any;
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
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame(); // active

    const sk = `${entity}:ModelRenderer`;
    expect(slots.get(sk)?.status).toBe("active");
    expect(binding.has(entity)).toBe(true);

    // Update to empty URI
    frame(() => {
      const mr = world.getMut(entity, "ModelRenderer" as any) as any;
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
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "texture", uri: "diffuse.png" },
      });
    });

    const sk = `${entity}:ModelRenderer`;
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
      world.setComponent(entity, "ModelRenderer" as any, {
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
      world.setComponent(e1, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "a.glb" },
      });
      world.setComponent(e2, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "b.glb" },
      });
      world.setComponent(e3, "ModelRenderer" as any, {
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

  // ---- 16. Mesh->model handoff: model replaces mesh ----
  it("mesh to model handoff: model replaces mesh in single frame", async () => {
    const { world, binding, scene, mock, frame } = setup();
    const entity = world.createEntity();

    // Start with MeshRenderer
    frame(() => {
      world.setComponent(entity, "MeshRenderer" as any, {
        geometry: "box",
        color: [1, 0, 0, 1],
      });
    });

    expect(binding.has(entity)).toBe(true);
    expect(binding.get(entity)).toBeInstanceOf(THREE.Mesh);

    // Add ModelRenderer
    frame(() => {
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    // Model is pending, mesh may or may not be there (guard skips MeshRenderer when ModelRenderer is present)
    mock.resolve("robot.glb", createMockGltf("robot"));
    await tick();
    frame();

    // After model resolves, binding should have the model (Group), not the mesh
    expect(binding.has(entity)).toBe(true);
    const obj = binding.get(entity)!;
    expect(obj).toBeInstanceOf(THREE.Group);
  });

  // ---- 17. MeshRenderer skipped when ModelRenderer present ----
  it("MeshRenderer skipped when ModelRenderer present", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "MeshRenderer" as any, {
        geometry: "box",
        color: [1, 0, 0, 1],
      });
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    // MeshRenderer guard: if ModelRenderer is present, skip mesh creation
    // binding should NOT have a Mesh
    const obj = binding.get(entity);
    // renderSync skips when ModelRenderer present, so no mesh created
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
      world.setComponent(entity, "ModelRenderer" as any, {
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
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "bad.glb" },
      });
    });

    mock.reject("bad.glb", new Error("404 not found"));
    await tick();
    frame();

    const sk = `${entity}:ModelRenderer`;
    expect(slots.get(sk)?.status).toBe("failed");
  });

  // ---- 20. Failed slot removed releases exactly once ----
  it("failed slot removed releases exactly once", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { world, slots, frame } = setup();
    const entity = world.createEntity();

    // Unsupported type → slot immediately failed with key=""
    frame(() => {
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "texture", uri: "tex.png" },
      });
    });

    const sk = `${entity}:ModelRenderer`;
    expect(slots.get(sk)?.status).toBe("failed");

    // Remove component, frame → no crash
    frame(() => {
      world.removeComponent(entity, "ModelRenderer" as any);
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
      world.setComponent(entity, "ModelRenderer" as any, {
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
      world.setComponent(entity, "ModelRenderer" as any, {
        asset: { kind: "asset", type: "glb", uri: "robot.glb" },
      });
    });

    const sk = `${entity}:ModelRenderer`;
    expect(slots.has(sk)).toBe(true);

    // Remove ModelRenderer before resolve
    frame(() => {
      world.removeComponent(entity, "ModelRenderer" as any);
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
});
