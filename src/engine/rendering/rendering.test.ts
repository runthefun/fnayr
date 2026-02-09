import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createWorld } from "../ecs/world";
import { CommandBuffer } from "../ecs/commands";
import { renderingRegistry } from "./components";
import { ThreeBinding } from "./binding";
import { createRenderSyncSystem, createTransformSyncSystem, createAssetResolveSystem, AssetResolver, createTextureHandler } from "./systems";
import { AssetManager } from "../assets/manager";

describe("Rendering bridge", () => {
  function setup() {
    const world = createWorld(renderingRegistry);
    const binding = new ThreeBinding(world);
    const renderSync = createRenderSyncSystem(binding);
    const transformSync = createTransformSyncSystem(binding);
    const assetManager = new AssetManager();
    const slots = new Map();
    const resolver = new AssetResolver();
    resolver.register(createTextureHandler() as any);
    const textureResolveSync = createAssetResolveSystem(assetManager, binding as any, slots, resolver as any);

    /** Begin a frame, run a setup callback, then execute sync systems, then end the frame. */
    function frame(fn?: () => void) {
      world.beginFrame();
      fn?.();
      const cmds = new CommandBuffer(world);
      renderSync(world, 0, cmds);
      textureResolveSync(world as any, 0, cmds as any);
      transformSync(world, 0, cmds);
      cmds.flush();
      world.endFrame();
    }

    return { world, binding, frame };
  }

  it("VisualRenderer mesh added → Mesh appears in scene", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer");
    });

    expect(binding.scene.children).toHaveLength(1);
    expect(binding.scene.children[0]).toBeInstanceOf(THREE.Mesh);
    expect(binding.get(entity)).toBe(binding.scene.children[0]);
  });

  it("Transform3D position syncs to Object3D", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "Transform3D", {
        position: [3, 5, 7],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      world.setComponent(entity, "VisualRenderer");
    });

    const obj = binding.get(entity)!;
    expect(obj.position.x).toBe(3);
    expect(obj.position.y).toBe(5);
    expect(obj.position.z).toBe(7);
  });

  it("entity destroyed → Mesh removed from scene", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer");
    });
    expect(binding.scene.children).toHaveLength(1);

    world.destroyEntity(entity);
    expect(binding.scene.children).toHaveLength(0);
    expect(binding.get(entity)).toBeUndefined();
  });

  it("VisualRenderer removed → Mesh removed from scene", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer");
    });
    expect(binding.scene.children).toHaveLength(1);

    frame(() => {
      world.removeComponent(entity, "VisualRenderer");
    });

    expect(binding.scene.children).toHaveLength(0);
    expect(binding.get(entity)).toBeUndefined();
  });

  it("multiple entities → correct scene children count + positions", () => {
    const { world, binding, frame } = setup();

    let entities: number[];
    frame(() => {
      entities = world.spawn(3, {
        VisualRenderer: { kind: "mesh" },
        Geometry: { kind: "box", width: 1, height: 1, depth: 1 },
        Transform3D: (i: number) => ({
          position: [i * 2, 0, 0] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [1, 1, 1] as [number, number, number],
        }),
      });
    });

    expect(binding.scene.children).toHaveLength(3);

    for (let i = 0; i < 3; i++) {
      const obj = binding.get(entities![i])!;
      expect(obj).toBeInstanceOf(THREE.Mesh);
      expect(obj.position.x).toBe(i * 2);
    }
  });

  it("schema defaults → correct Object3D state (scale=1, quat identity)", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "Transform3D");
      world.setComponent(entity, "VisualRenderer");
    });

    const obj = binding.get(entity)!;
    expect(obj.position.x).toBe(0);
    expect(obj.position.y).toBe(0);
    expect(obj.position.z).toBe(0);
    expect(obj.scale.x).toBe(1);
    expect(obj.scale.y).toBe(1);
    expect(obj.scale.z).toBe(1);
    expect(obj.quaternion.x).toBe(0);
    expect(obj.quaternion.y).toBe(0);
    expect(obj.quaternion.z).toBe(0);
    expect(obj.quaternion.w).toBe(1);
  });

  it("color update → material color changes via MeshMaterial", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer", {
        kind: "mesh",
      });
      world.setComponent(entity, "Geometry", {
        kind: "box",
        width: 1,
        height: 1,
        depth: 1,
      });
      world.setComponent(entity, "MeshMaterial", {
        texture: { kind: "asset", type: "texture", uri: "" },
        color: [1, 0, 0, 1],
      });
    });

    const mesh = binding.get(entity) as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.color.r).toBe(1);
    expect(mat.color.g).toBe(0);
    expect(mat.color.b).toBe(0);

    frame(() => {
      const mm = world.getMut(entity, "MeshMaterial")! as any;
      mm.color = [0, 1, 0, 1];
    });

    expect(mat.color.r).toBe(0);
    expect(mat.color.g).toBe(1);
    expect(mat.color.b).toBe(0);
  });

  it("Transform3D update syncs position to Object3D", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "Transform3D", {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      world.setComponent(entity, "VisualRenderer");
    });

    frame(() => {
      const t = world.getMut(entity, "Transform3D")!;
      t.position = [10, 20, 30];
    });

    const obj = binding.get(entity)!;
    expect(obj.position.x).toBe(10);
    expect(obj.position.y).toBe(20);
    expect(obj.position.z).toBe(30);
  });

  it("geometry swap updates the mesh geometry", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer", {
        kind: "mesh",
      });
      world.setComponent(entity, "Geometry", {
        kind: "box",
        width: 1,
        height: 1,
        depth: 1,
      });
    });

    const mesh = binding.get(entity) as THREE.Mesh;
    expect(mesh.geometry).toBeInstanceOf(THREE.BoxGeometry);

    frame(() => {
      world.setComponent(entity, "Geometry", {
        kind: "sphere",
        radius: 0.5,
        widthSegments: 32,
        heightSegments: 16,
      });
    });

    expect(mesh.geometry).toBeInstanceOf(THREE.SphereGeometry);
  });

  it("binding replacement disposes previous mesh resources", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.setComponent(entity, "VisualRenderer", {
        kind: "mesh",
      });
      world.setComponent(entity, "Geometry", {
        kind: "box",
        width: 1,
        height: 1,
        depth: 1,
      });
    });

    const firstMesh = binding.get(entity) as THREE.Mesh;
    const geometryDisposeSpy = vi.spyOn(firstMesh.geometry, "dispose");
    const materialDisposeSpy = vi.spyOn(
      firstMesh.material as THREE.Material,
      "dispose"
    );

    const replacement = new THREE.Mesh(
      new THREE.SphereGeometry(),
      new THREE.MeshStandardMaterial()
    );
    replacement.userData.entityId = entity;
    binding.set(entity, replacement);
    binding.scene.add(replacement);

    expect(geometryDisposeSpy).toHaveBeenCalledTimes(1);
    expect(materialDisposeSpy).toHaveBeenCalledTimes(1);
  });
});
