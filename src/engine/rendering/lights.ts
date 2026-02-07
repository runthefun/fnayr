import * as THREE from "three";
import type { World } from "../ecs/types";
import type { Commands } from "../ecs/commands";
import type { System } from "../ecs/systems";
import type { renderingRegistry } from "./components";
import { EDITOR_LAYER } from "./constants";

type LightRegistry = typeof renderingRegistry;
type EntityId = number;

export function createLightSyncSystem(
  scene: THREE.Scene
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
      directionalLights.set(entity, light);
      scene.add(light);

      const helper = new THREE.DirectionalLightHelper(light, 1);
      addHelper(entity, helper);
    }
    for (const entity of world.getRemoved("DirectionalLight" as any)) {
      const light = directionalLights.get(entity);
      if (light) {
        light.removeFromParent();
        directionalLights.delete(entity);
      }
      removeHelper(entity);
    }
    for (const entity of world.getUpdated("DirectionalLight" as any)) {
      const light = directionalLights.get(entity);
      if (!light) continue;
      const data = world.getComponent(entity, "DirectionalLight" as any) as any;
      if (!data) continue;
      light.color.setRGB(data.color[0], data.color[1], data.color[2]);
      light.intensity = data.intensity;
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
      ambientLights.set(entity, light);
      scene.add(light);
      // No helper for ambient lights (no position/direction)
    }
    for (const entity of world.getRemoved("AmbientLight" as any)) {
      const light = ambientLights.get(entity);
      if (light) {
        light.removeFromParent();
        ambientLights.delete(entity);
      }
    }
    for (const entity of world.getUpdated("AmbientLight" as any)) {
      const light = ambientLights.get(entity);
      if (!light) continue;
      const data = world.getComponent(entity, "AmbientLight" as any) as any;
      if (!data) continue;
      light.color.setRGB(data.color[0], data.color[1], data.color[2]);
      light.intensity = data.intensity;
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
      pointLights.set(entity, light);
      scene.add(light);

      const helper = new THREE.PointLightHelper(light, 0.5);
      addHelper(entity, helper);
    }
    for (const entity of world.getRemoved("PointLight" as any)) {
      const light = pointLights.get(entity);
      if (light) {
        light.removeFromParent();
        pointLights.delete(entity);
      }
      removeHelper(entity);
    }
    for (const entity of world.getUpdated("PointLight" as any)) {
      const light = pointLights.get(entity);
      if (!light) continue;
      const data = world.getComponent(entity, "PointLight" as any) as any;
      if (!data) continue;
      light.color.setRGB(data.color[0], data.color[1], data.color[2]);
      light.intensity = data.intensity;
      light.distance = data.distance;
      light.decay = data.decay;
      const helper = helpers.get(entity);
      if (helper && "update" in helper) (helper as any).update();
    }

    // --- SpotLight ---
    for (const entity of world.getAdded("SpotLight" as any)) {
      const data = world.getComponent(entity, "SpotLight" as any) as any;
      if (!data) continue;
      const light = new THREE.SpotLight(
        data.color,
        data.intensity,
        data.distance,
        data.angle,
        data.penumbra,
        data.decay
      );
      light.castShadow = data.castShadow;
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
      spotLights.set(entity, light);
      scene.add(light);

      if (data.showHelper) {
        const helper = new THREE.SpotLightHelper(light);
        addHelper(entity, helper);
      }
    }
    for (const entity of world.getRemoved("SpotLight" as any)) {
      const light = spotLights.get(entity);
      if (light) {
        light.removeFromParent();
        spotLights.delete(entity);
      }
      removeHelper(entity);
    }
    for (const entity of world.getUpdated("SpotLight" as any)) {
      const light = spotLights.get(entity);
      if (!light) continue;
      const data = world.getComponent(entity, "SpotLight" as any) as any;
      if (!data) continue;
      light.color.set(data.color);
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

    // --- Transform3D sync for light entities ---
    function getLightObject(entity: EntityId): THREE.Object3D | undefined {
      return (
        directionalLights.get(entity) ??
        pointLights.get(entity) ??
        spotLights.get(entity)
      );
    }

    for (const entity of world.getAdded("Transform3D" as any)) {
      const obj = getLightObject(entity);
      if (!obj) continue;
      const t = world.getComponent(entity, "Transform3D" as any) as any;
      if (t) obj.position.set(t.position[0], t.position[1], t.position[2]);
    }
    for (const entity of world.getUpdated("Transform3D" as any)) {
      const obj = getLightObject(entity);
      if (!obj) continue;
      const t = world.getComponent(entity, "Transform3D" as any) as any;
      if (t) obj.position.set(t.position[0], t.position[1], t.position[2]);
    }

    // Update all helpers each frame (position may have changed via transform system)
    for (const helper of helpers.values()) {
      if ("update" in helper) (helper as any).update();
    }
  };
}
