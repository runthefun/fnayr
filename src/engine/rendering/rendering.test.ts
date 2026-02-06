import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createWorld } from "../ecs/world";
import { CommandBuffer } from "../ecs/commands";
import { renderingRegistry } from "./components";
import { ThreeBinding } from "./binding";
import { createRenderSyncSystem } from "./systems";

describe("Rendering bridge", () => {
  function setup() {
    const world = createWorld(renderingRegistry);
    const binding = new ThreeBinding(world);
    const syncSystem = createRenderSyncSystem(binding);

    /** Run the sync system within a frame (beginFrame → system → endFrame). */
    function runSync() {
      world.beginFrame();
      const cmds = new CommandBuffer(world);
      syncSystem(world, 0, cmds);
      cmds.flush();
      world.endFrame();
    }

    /** Begin a frame, run a setup callback, then execute the sync system, then end the frame. */
    function frame(fn?: () => void) {
      world.beginFrame();
      fn?.();
      const cmds = new CommandBuffer(world);
      syncSystem(world, 0, cmds);
      cmds.flush();
      world.endFrame();
    }

    return { world, binding, syncSystem, runSync, frame };
  }

  it("MeshRenderer added → Mesh appears in scene", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.addComponent(entity, "MeshRenderer");
    });

    expect(binding.scene.children).toHaveLength(1);
    expect(binding.scene.children[0]).toBeInstanceOf(THREE.Mesh);
    expect(binding.get(entity)).toBe(binding.scene.children[0]);
  });

  it("Transform3D position syncs to Object3D", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.addComponent(entity, "Transform3D", {
        position: [3, 5, 7],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      world.addComponent(entity, "MeshRenderer");
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
      world.addComponent(entity, "MeshRenderer");
    });
    expect(binding.scene.children).toHaveLength(1);

    world.destroyEntity(entity);
    expect(binding.scene.children).toHaveLength(0);
    expect(binding.get(entity)).toBeUndefined();
  });

  it("MeshRenderer removed → Mesh removed from scene", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.addComponent(entity, "MeshRenderer");
    });
    expect(binding.scene.children).toHaveLength(1);

    frame(() => {
      world.removeComponent(entity, "MeshRenderer");
    });

    expect(binding.scene.children).toHaveLength(0);
    expect(binding.get(entity)).toBeUndefined();
  });

  it("multiple entities → correct scene children count + positions", () => {
    const { world, binding, frame } = setup();

    let entities: number[];
    frame(() => {
      entities = world.spawn(3, {
        MeshRenderer: { geometry: "box", color: [1, 0, 0, 1] },
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
      world.addComponent(entity, "Transform3D");
      world.addComponent(entity, "MeshRenderer");
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

  it("color update → material color changes", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.addComponent(entity, "MeshRenderer", {
        geometry: "box",
        color: [1, 0, 0, 1],
      });
    });

    const mesh = binding.get(entity) as THREE.Mesh;
    const mat = mesh.material as THREE.MeshStandardMaterial;
    expect(mat.color.r).toBe(1);
    expect(mat.color.g).toBe(0);
    expect(mat.color.b).toBe(0);

    frame(() => {
      const mr = world.getMut(entity, "MeshRenderer")!;
      mr.color = [0, 1, 0, 1];
    });

    expect(mat.color.r).toBe(0);
    expect(mat.color.g).toBe(1);
    expect(mat.color.b).toBe(0);
  });

  it("Transform3D update syncs position to Object3D", () => {
    const { world, binding, frame } = setup();
    const entity = world.createEntity();

    frame(() => {
      world.addComponent(entity, "Transform3D", {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      world.addComponent(entity, "MeshRenderer");
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
      world.addComponent(entity, "MeshRenderer", {
        geometry: "box",
        color: [0.8, 0.8, 0.8, 1],
      });
    });

    const mesh = binding.get(entity) as THREE.Mesh;
    expect(mesh.geometry).toBeInstanceOf(THREE.BoxGeometry);

    frame(() => {
      const mr = world.getMut(entity, "MeshRenderer")!;
      mr.geometry = "sphere";
    });

    expect(mesh.geometry).toBeInstanceOf(THREE.SphereGeometry);
  });
});
