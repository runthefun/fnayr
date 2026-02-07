import * as THREE from "three";
import type { ComponentRegistry, World } from "../ecs/types";
import type { Commands } from "../ecs/commands";
import type { System } from "../ecs/systems";
import type { ThreeBinding } from "./binding";
import type { renderingRegistry } from "./components";
import { EDITOR_LAYER } from "./constants";

type LightRegistry = typeof renderingRegistry & ComponentRegistry;
type EntityId = number;

export function createLightSyncSystem<R extends LightRegistry>(
  binding: ThreeBinding<R>
): System<R> {
  // Helpers live in the scene as siblings of the lights.
  // We track them so we can update/dispose them on light changes or removal.
  const helpers = new Map<EntityId, THREE.Object3D>();

  function addHelper(entity: EntityId, helper: THREE.Object3D): void {
    helper.userData.entityId = entity;
    helper.layers.set(EDITOR_LAYER);
    helper.traverse((child) => child.layers.set(EDITOR_LAYER));
    helpers.set(entity, helper);
    binding.scene.add(helper);
  }

  function removeHelper(entity: EntityId): void {
    const helper = helpers.get(entity);
    if (!helper) return;
    helper.removeFromParent();
    if ("dispose" in helper && typeof helper.dispose === "function") {
      helper.dispose();
    }
    helpers.delete(entity);
  }

  return (world: World<R>, _dt: number, _commands: Commands<R>) => {
    // --- DirectionalLight ---
    for (const entity of world.getAdded("DirectionalLight" as any)) {
      const data = world.getComponent(entity, "DirectionalLight" as any) as any;
      if (!data) continue;
      const light = new THREE.DirectionalLight(
        new THREE.Color(data.color[0], data.color[1], data.color[2]),
        data.intensity
      );
      const transform = world.getComponent(
        entity,
        "Transform3D" as any
      ) as any;
      if (transform) {
        light.position.set(
          transform.position[0],
          transform.position[1],
          transform.position[2]
        );
      }
      light.userData.entityId = entity;
      binding.set(entity, light);
      binding.scene.add(light);

      const helper = new THREE.DirectionalLightHelper(light, 1);
      addHelper(entity, helper);
    }
    for (const entity of world.getRemoved("DirectionalLight" as any)) {
      if (!world.hasComponent(entity, "MeshRenderer" as any)) {
        removeHelper(entity);
        binding.delete(entity);
      }
    }
    for (const entity of world.getUpdated("DirectionalLight" as any)) {
      const obj = binding.get(entity);
      if (!obj || !(obj instanceof THREE.DirectionalLight)) continue;
      const data = world.getComponent(entity, "DirectionalLight" as any) as any;
      if (!data) continue;
      obj.color.setRGB(data.color[0], data.color[1], data.color[2]);
      obj.intensity = data.intensity;
      const helper = helpers.get(entity);
      if (helper && "update" in helper) (helper as any).update();
    }

    // --- AmbientLight ---
    for (const entity of world.getAdded("AmbientLight" as any)) {
      const data = world.getComponent(entity, "AmbientLight" as any) as any;
      if (!data) continue;
      const light = new THREE.AmbientLight(
        new THREE.Color(data.color[0], data.color[1], data.color[2]),
        data.intensity
      );
      light.userData.entityId = entity;
      binding.set(entity, light);
      binding.scene.add(light);
      // No helper for ambient lights (no position/direction)
    }
    for (const entity of world.getRemoved("AmbientLight" as any)) {
      if (!world.hasComponent(entity, "MeshRenderer" as any)) {
        binding.delete(entity);
      }
    }
    for (const entity of world.getUpdated("AmbientLight" as any)) {
      const obj = binding.get(entity);
      if (!obj || !(obj instanceof THREE.AmbientLight)) continue;
      const data = world.getComponent(entity, "AmbientLight" as any) as any;
      if (!data) continue;
      obj.color.setRGB(data.color[0], data.color[1], data.color[2]);
      obj.intensity = data.intensity;
    }

    // --- PointLight ---
    for (const entity of world.getAdded("PointLight" as any)) {
      const data = world.getComponent(entity, "PointLight" as any) as any;
      if (!data) continue;
      const light = new THREE.PointLight(
        new THREE.Color(data.color[0], data.color[1], data.color[2]),
        data.intensity,
        data.distance,
        data.decay
      );
      const transform = world.getComponent(
        entity,
        "Transform3D" as any
      ) as any;
      if (transform) {
        light.position.set(
          transform.position[0],
          transform.position[1],
          transform.position[2]
        );
      }
      light.userData.entityId = entity;
      binding.set(entity, light);
      binding.scene.add(light);

      const helper = new THREE.PointLightHelper(light, 0.5);
      addHelper(entity, helper);
    }
    for (const entity of world.getRemoved("PointLight" as any)) {
      if (!world.hasComponent(entity, "MeshRenderer" as any)) {
        removeHelper(entity);
        binding.delete(entity);
      }
    }
    for (const entity of world.getUpdated("PointLight" as any)) {
      const obj = binding.get(entity);
      if (!obj || !(obj instanceof THREE.PointLight)) continue;
      const data = world.getComponent(entity, "PointLight" as any) as any;
      if (!data) continue;
      obj.color.setRGB(data.color[0], data.color[1], data.color[2]);
      obj.intensity = data.intensity;
      obj.distance = data.distance;
      obj.decay = data.decay;
      const helper = helpers.get(entity);
      if (helper && "update" in helper) (helper as any).update();
    }

    // Update all helpers each frame (position may have changed via transform system)
    for (const helper of helpers.values()) {
      if ("update" in helper) (helper as any).update();
    }
  };
}
