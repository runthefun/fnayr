import * as THREE from "three";
import type { ComponentRegistry, World } from "../ecs/types";
import type { Commands } from "../ecs/commands";
import type { System } from "../ecs/systems";
import type { ThreeBinding } from "./binding";
import type { renderingRegistry } from "./components";

type RenderRegistry = typeof renderingRegistry & ComponentRegistry;

function createGeometry(
  type: "box" | "sphere" | "plane"
): THREE.BufferGeometry {
  switch (type) {
    case "box":
      return new THREE.BoxGeometry();
    case "sphere":
      return new THREE.SphereGeometry(0.5, 32, 16);
    case "plane":
      return new THREE.PlaneGeometry(1, 1);
  }
}

export function applyTransform(
  obj: THREE.Object3D,
  data: { position: number[]; rotation: number[]; scale: number[] }
): void {
  obj.position.set(data.position[0], data.position[1], data.position[2]);
  obj.quaternion.set(
    data.rotation[0],
    data.rotation[1],
    data.rotation[2],
    data.rotation[3]
  );
  obj.scale.set(data.scale[0], data.scale[1], data.scale[2]);
}

/**
 * Creates a system that synchronizes ECS MeshRenderer components
 * into the Three.js scene graph managed by the given binding.
 */
export function createRenderSyncSystem<R extends RenderRegistry>(
  binding: ThreeBinding<R>,
): System<R> {
  return (world: World<R>, _dt: number, _commands: Commands<R>) => {
    // 1. Added MeshRenderer — create mesh and add to scene
    for (const entity of world.getAdded("MeshRenderer" as any)) {
      const mr = world.getComponent(entity, "MeshRenderer" as any) as any;
      if (!mr) continue;

      const geometry = createGeometry(mr.geometry);
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(mr.color[0], mr.color[1], mr.color[2]),
        opacity: mr.color[3],
        transparent: mr.color[3] < 1,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.userData.entityId = entity;

      // Apply initial transform if present
      const transform = world.getComponent(entity, "Transform3D" as any) as any;
      if (transform) {
        applyTransform(mesh, transform);
      }

      binding.set(entity, mesh);
      binding.scene.add(mesh);
    }

    // 2. Removed MeshRenderer — remove from scene
    for (const entity of world.getRemoved("MeshRenderer" as any)) {
      binding.delete(entity);
    }

    // 3. Updated MeshRenderer — update material/geometry
    for (const entity of world.getUpdated("MeshRenderer" as any)) {
      const obj = binding.get(entity);
      if (!obj || !(obj instanceof THREE.Mesh)) continue;
      const mr = world.getComponent(entity, "MeshRenderer" as any) as any;
      if (!mr) continue;

      // Update material color
      const mat = obj.material as THREE.MeshStandardMaterial;
      mat.color.setRGB(mr.color[0], mr.color[1], mr.color[2]);
      mat.opacity = mr.color[3];
      mat.transparent = mr.color[3] < 1;

      // Swap geometry if type changed
      const currentGeoType =
        obj.geometry instanceof THREE.BoxGeometry
          ? "box"
          : obj.geometry instanceof THREE.SphereGeometry
            ? "sphere"
            : "plane";
      if (currentGeoType !== mr.geometry) {
        obj.geometry.dispose();
        obj.geometry = createGeometry(mr.geometry);
      }
    }
  };
}

/**
 * Creates a system that synchronizes Transform3D components to the
 * Three.js Object3D transform for any entity present in the binding.
 *
 * Run this AFTER visual-creation systems (renderSync, lightSync) so
 * that the Object3D already exists in the binding.
 */
export function createTransformSyncSystem<R extends RenderRegistry>(
  binding: ThreeBinding<R>,
  options?: {
    shouldSkipTransform?: (entity: number) => boolean;
    hierarchy?: { getParent(entity: number): number | undefined };
  },
): System<R> {
  const shouldSkipTransform = options?.shouldSkipTransform;
  const hierarchy = options?.hierarchy;

  return (world: World<R>, _dt: number, _commands: Commands<R>) => {
    // 1. Sync Transform3D → Object3D position/rotation/scale
    for (const entity of world.getAdded("Transform3D" as any)) {
      if (shouldSkipTransform?.(entity)) continue;
      const obj = binding.get(entity);
      if (!obj) continue;
      const transform = world.getComponent(entity, "Transform3D" as any) as any;
      if (transform) applyTransform(obj, transform);
    }
    for (const entity of world.getUpdated("Transform3D" as any)) {
      if (shouldSkipTransform?.(entity)) continue;
      const obj = binding.get(entity);
      if (!obj) continue;
      const transform = world.getComponent(entity, "Transform3D" as any) as any;
      if (transform) applyTransform(obj, transform);
    }

    // 2. Sync hierarchy parenting
    if (hierarchy) {
      binding.forEach((entity, obj) => {
        const ecsParent = hierarchy.getParent(entity);
        if (ecsParent !== undefined) {
          const parentObj = binding.get(ecsParent);
          if (parentObj && obj.parent !== parentObj) {
            parentObj.add(obj); // Three.js handles removing from old parent
          }
        } else {
          // Should be a root — parent should be the scene
          if (obj.parent !== binding.scene) {
            binding.scene.add(obj);
          }
        }
      });
    }
  };
}
