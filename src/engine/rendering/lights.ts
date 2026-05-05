import * as THREE from "three";
import type { ComponentType, World } from "../ecs/types";
import type { Commands } from "../ecs/commands";
import type { System } from "../ecs/systems";
import type { renderingRegistry } from "./components";
import type { ThreeBinding } from "./binding";
import { EDITOR_LAYER } from "./constants";

type LightRegistry = typeof renderingRegistry;
type EntityId = number;

export function createBackgroundSyncSystem(
  scene: THREE.Scene
): System<LightRegistry> {
  function applyBackground(data: any): void {
    scene.background = new THREE.Color(data.color[0], data.color[1], data.color[2]);
    scene.backgroundIntensity = data.intensity;
    scene.backgroundBlurriness = data.blurriness;
  }

  return (world: World<LightRegistry>, _dt: number, _commands: Commands<LightRegistry>) => {
    for (const _entity of world.getRemoved("Background" as ComponentType<LightRegistry>)) {
      scene.background = null;
      scene.backgroundIntensity = 1;
      scene.backgroundBlurriness = 0;
    }
    for (const entity of world.getAdded("Background" as ComponentType<LightRegistry>)) {
      const data = world.getComponent(entity, "Background" as ComponentType<LightRegistry>) as any;
      if (!data) continue;
      applyBackground(data);
    }
    for (const entity of world.getUpdated("Background" as ComponentType<LightRegistry>)) {
      const data = world.getComponent(entity, "Background" as ComponentType<LightRegistry>) as any;
      if (!data) continue;
      applyBackground(data);
    }
  };
}

export function createLightSyncSystem(
  scene: THREE.Scene,
  binding: ThreeBinding<LightRegistry>
): System<LightRegistry> {
  const directionalLights = new Map<EntityId, THREE.DirectionalLight>();
  const pointLights = new Map<EntityId, THREE.PointLight>();
  const spotLights = new Map<EntityId, THREE.SpotLight>();
  const ambientLights = new Map<EntityId, THREE.AmbientLight>();

  // Helpers live in the scene as siblings of the lights.
  // We track them so we can update/dispose them on light changes or removal.
  const helpers = new Map<EntityId, THREE.Object3D>();

  function addHelper(entity: EntityId, helper: THREE.Object3D): void {
    helper.userData.entityId = entity;
    helper.layers.set(EDITOR_LAYER);
    helper.traverse((child) => child.layers.set(EDITOR_LAYER));
    helpers.set(entity, helper);
    scene.add(helper);
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

  return (world: World<LightRegistry>, _dt: number, _commands: Commands<LightRegistry>) => {
    // --- DirectionalLight ---
    for (const entity of world.getAdded("DirectionalLight" as ComponentType<LightRegistry>)) {
      const data = world.getComponent(entity, "DirectionalLight" as ComponentType<LightRegistry>) as any;
      if (!data) continue;
      const light = new THREE.DirectionalLight(
        new THREE.Color(data.color[0], data.color[1], data.color[2]),
        data.intensity
      );
      light.userData.entityId = entity;
      directionalLights.set(entity, light);
      scene.add(light);
      binding.set(entity, light);

      const helper = new THREE.DirectionalLightHelper(light, 1);
      addHelper(entity, helper);
    }
    for (const entity of world.getRemoved("DirectionalLight" as ComponentType<LightRegistry>)) {
      const light = directionalLights.get(entity);
      if (light) {
        light.removeFromParent();
        directionalLights.delete(entity);
        binding.delete(entity);
      }
      removeHelper(entity);
    }
    for (const entity of world.getUpdated("DirectionalLight" as ComponentType<LightRegistry>)) {
      const light = directionalLights.get(entity);
      if (!light) continue;
      const data = world.getComponent(entity, "DirectionalLight" as ComponentType<LightRegistry>) as any;
      if (!data) continue;
      light.color.setRGB(data.color[0], data.color[1], data.color[2]);
      light.intensity = data.intensity;
      const helper = helpers.get(entity);
      if (helper && "update" in helper) (helper as any).update();
    }

    // --- AmbientLight ---
    for (const entity of world.getAdded("AmbientLight" as ComponentType<LightRegistry>)) {
      const data = world.getComponent(entity, "AmbientLight" as ComponentType<LightRegistry>) as any;
      if (!data) continue;
      const light = new THREE.AmbientLight(
        new THREE.Color(data.color[0], data.color[1], data.color[2]),
        data.intensity
      );
      light.userData.entityId = entity;
      ambientLights.set(entity, light);
      scene.add(light);
      // No helper for ambient lights (no position/direction)
    }
    for (const entity of world.getRemoved("AmbientLight" as ComponentType<LightRegistry>)) {
      const light = ambientLights.get(entity);
      if (light) {
        light.removeFromParent();
        ambientLights.delete(entity);
      }
    }
    for (const entity of world.getUpdated("AmbientLight" as ComponentType<LightRegistry>)) {
      const light = ambientLights.get(entity);
      if (!light) continue;
      const data = world.getComponent(entity, "AmbientLight" as ComponentType<LightRegistry>) as any;
      if (!data) continue;
      light.color.setRGB(data.color[0], data.color[1], data.color[2]);
      light.intensity = data.intensity;
    }

    // --- PointLight ---
    for (const entity of world.getAdded("PointLight" as ComponentType<LightRegistry>)) {
      const data = world.getComponent(entity, "PointLight" as ComponentType<LightRegistry>) as any;
      if (!data) continue;
      const light = new THREE.PointLight(
        new THREE.Color(data.color[0], data.color[1], data.color[2]),
        data.intensity,
        data.distance,
        data.decay
      );
      light.userData.entityId = entity;
      pointLights.set(entity, light);
      scene.add(light);
      binding.set(entity, light);

      const helper = new THREE.PointLightHelper(light, 0.5);
      addHelper(entity, helper);
    }
    for (const entity of world.getRemoved("PointLight" as ComponentType<LightRegistry>)) {
      const light = pointLights.get(entity);
      if (light) {
        light.removeFromParent();
        pointLights.delete(entity);
        binding.delete(entity);
      }
      removeHelper(entity);
    }
    for (const entity of world.getUpdated("PointLight" as ComponentType<LightRegistry>)) {
      const light = pointLights.get(entity);
      if (!light) continue;
      const data = world.getComponent(entity, "PointLight" as ComponentType<LightRegistry>) as any;
      if (!data) continue;
      light.color.setRGB(data.color[0], data.color[1], data.color[2]);
      light.intensity = data.intensity;
      light.distance = data.distance;
      light.decay = data.decay;
      const helper = helpers.get(entity);
      if (helper && "update" in helper) (helper as any).update();
    }

    // --- SpotLight ---
    for (const entity of world.getAdded("SpotLight" as ComponentType<LightRegistry>)) {
      const data = world.getComponent(entity, "SpotLight" as ComponentType<LightRegistry>) as any;
      if (!data) continue;
      const light = new THREE.SpotLight(
        new THREE.Color(data.color[0], data.color[1], data.color[2]),
        data.intensity,
        data.distance,
        data.angle,
        data.penumbra,
        data.decay
      );
      light.castShadow = data.castShadow;
      light.userData.entityId = entity;
      spotLights.set(entity, light);
      scene.add(light);
      binding.set(entity, light);

      if (data.showHelper) {
        const helper = new THREE.SpotLightHelper(light);
        addHelper(entity, helper);
      }
    }
    for (const entity of world.getRemoved("SpotLight" as ComponentType<LightRegistry>)) {
      const light = spotLights.get(entity);
      if (light) {
        light.removeFromParent();
        spotLights.delete(entity);
        binding.delete(entity);
      }
      removeHelper(entity);
    }
    for (const entity of world.getUpdated("SpotLight" as ComponentType<LightRegistry>)) {
      const light = spotLights.get(entity);
      if (!light) continue;
      const data = world.getComponent(entity, "SpotLight" as ComponentType<LightRegistry>) as any;
      if (!data) continue;
      light.color.setRGB(data.color[0], data.color[1], data.color[2]);
      light.intensity = data.intensity;
      light.distance = data.distance;
      light.angle = data.angle;
      light.penumbra = data.penumbra;
      light.decay = data.decay;
      light.castShadow = data.castShadow;

      // Toggle helper on/off based on showHelper
      const existingHelper = helpers.get(entity);
      if (data.showHelper && !existingHelper) {
        const helper = new THREE.SpotLightHelper(light);
        addHelper(entity, helper);
      } else if (!data.showHelper && existingHelper) {
        removeHelper(entity);
      } else if (existingHelper && "update" in existingHelper) {
        (existingHelper as any).update();
      }
    }

    // Update all helpers each frame (position may have changed via transform system)
    for (const helper of helpers.values()) {
      if ("update" in helper) (helper as any).update();
    }
  };
}
