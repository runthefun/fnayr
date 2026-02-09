import * as THREE from "three";
import type { ComponentRegistry, ComponentType, World } from "../ecs/types";
import type { Commands } from "../ecs/commands";
import type { System } from "../ecs/systems";
import type { ThreeBinding } from "./binding";
import type { renderingRegistry, renderingResources } from "./components";
import { AssetManager } from "../assets/manager";
import type { SchemaLike } from "../schema";
import {
  createAssetRequestSystem as createGenericAssetRequestSystem,
  createAssetResolveSystem as createGenericAssetResolveSystem,
  AssetResolver as AssetResolverImpl,
} from "../assets/systems";
import type { SlotEntry } from "../assets/systems";

// Re-export types from the generic asset systems for backward compatibility
export type { SlotEntry } from "../assets/systems";
export {
  AssetResolver,
  findAssetRefPaths,
  getNestedValue,
} from "../assets/systems";
export type {
  AssetTypeHandler,
  AssetReadyHandler,
  AssetClearHandler,
  ComponentSyncHandler,
} from "../assets/systems";

// Re-export handlers from asset-handlers
export { createModelHandler, createTextureHandler } from "./asset-handlers";

type RenderRegistry = typeof renderingRegistry & ComponentRegistry;
type RenderResources = typeof renderingResources;

// Concrete data shapes for typed assertions (mirrors schema-derived values)
type Transform3DData = { position: number[]; rotation: number[]; scale: number[] };

type MeshData = {
  kind: "mesh";
};

type GeometryData =
  | { kind: "box"; width: number; height: number; depth: number }
  | { kind: "sphere"; radius: number; widthSegments: number; heightSegments: number }
  | { kind: "plane"; width: number; height: number };

type ModelData = {
  kind: "model";
  asset: { type: string; uri: string; sub?: string; options?: Record<string, unknown> };
};

type VisualRendererData = MeshData | ModelData;

type MeshMaterialData = {
  texture: { type: string; uri: string; sub?: string; options?: Record<string, unknown> };
  color: [number, number, number, number];
};

function createGeometry(
  geo?: GeometryData
): THREE.BufferGeometry {
  if (!geo) return new THREE.BoxGeometry();
  switch (geo.kind) {
    case "box":
      return new THREE.BoxGeometry(geo.width, geo.height, geo.depth);
    case "sphere":
      return new THREE.SphereGeometry(geo.radius, geo.widthSegments, geo.heightSegments);
    case "plane":
      return new THREE.PlaneGeometry(geo.width, geo.height);
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

function createMeshObject<R extends RenderRegistry>(
  _mr: MeshData,
  entity: number,
  world: World<R>,
  binding: ThreeBinding<R>,
): void {
  const geo = world.getComponent(entity, "Geometry" as ComponentType<R>) as GeometryData | undefined;
  const geometry = createGeometry(geo);
  // Read color from MeshMaterial component if present, else default gray
  const meshMat = world.getComponent(entity, "MeshMaterial" as ComponentType<R>) as MeshMaterialData | undefined;
  const color = meshMat?.color ?? [0.8, 0.8, 0.8, 1.0];
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color[0], color[1], color[2]),
    opacity: color[3],
    transparent: color[3] < 1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.entityId = entity;

  const transform = world.getComponent(entity, "Transform3D" as ComponentType<R>) as Transform3DData | undefined;
  if (transform) {
    applyTransform(mesh, transform);
  }

  binding.set(entity, mesh);
  binding.scene.add(mesh);
}

/**
 * Creates a system that synchronizes ECS VisualRenderer components
 * into the Three.js scene graph managed by the given binding.
 */
export function createRenderSyncSystem<R extends RenderRegistry>(
  binding: ThreeBinding<R>,
): System<R> {
  return (world: World<R>, _dt: number, _commands: Commands<R>) => {
    // 1. Added VisualRenderer
    for (const entity of world.getAdded("VisualRenderer" as ComponentType<R>)) {
      const vr = world.getComponent(entity, "VisualRenderer" as ComponentType<R>) as VisualRendererData | undefined;
      if (!vr) continue;

      if (vr.kind === "mesh") {
        createMeshObject(vr, entity, world, binding);
      } else if (vr.kind === "model") {
        // Create a placeholder Group so transform sync, hierarchy, and
        // selection work while the model loads asynchronously.
        const placeholder = new THREE.Group();
        placeholder.userData.entityId = entity;
        const transform = world.getComponent(entity, "Transform3D" as ComponentType<R>) as Transform3DData | undefined;
        if (transform) applyTransform(placeholder, transform);
        binding.set(entity, placeholder);
        binding.scene.add(placeholder);
      }
    }

    // 2. Removed VisualRenderer — delete binding
    for (const entity of world.getRemoved("VisualRenderer" as ComponentType<R>)) {
      binding.delete(entity);
    }

    // 3. Updated VisualRenderer — dispatch on kind
    for (const entity of world.getUpdated("VisualRenderer" as ComponentType<R>)) {
      const vr = world.getComponent(entity, "VisualRenderer" as ComponentType<R>) as VisualRendererData | undefined;
      if (!vr) continue;

      if (vr.kind === "mesh") {
        const obj = binding.get(entity);
        if (!obj || !(obj instanceof THREE.Mesh)) {
          // Was model (or nothing) — delete old binding and create mesh
          binding.delete(entity);
          createMeshObject(vr, entity, world, binding);
        }
      } else if (vr.kind === "model") {
        const obj = binding.get(entity);
        if (obj && obj instanceof THREE.Mesh) {
          // Was mesh — replace with placeholder Group for model loading
          binding.delete(entity);
          const placeholder = new THREE.Group();
          placeholder.userData.entityId = entity;
          const transform = world.getComponent(entity, "Transform3D" as ComponentType<R>) as Transform3DData | undefined;
          if (transform) applyTransform(placeholder, transform);
          binding.set(entity, placeholder);
          binding.scene.add(placeholder);
        }
      }
    }

    // 4. Geometry component changes — swap geometry on existing meshes
    for (const entity of world.getAdded("Geometry" as ComponentType<R>)) {
      const obj = binding.get(entity);
      if (obj && obj instanceof THREE.Mesh) {
        const geo = world.getComponent(entity, "Geometry" as ComponentType<R>) as GeometryData | undefined;
        obj.geometry.dispose();
        obj.geometry = createGeometry(geo);
      }
    }
    for (const entity of world.getUpdated("Geometry" as ComponentType<R>)) {
      const obj = binding.get(entity);
      if (obj && obj instanceof THREE.Mesh) {
        const geo = world.getComponent(entity, "Geometry" as ComponentType<R>) as GeometryData | undefined;
        obj.geometry.dispose();
        obj.geometry = createGeometry(geo);
      }
    }
    for (const entity of world.getRemoved("Geometry" as ComponentType<R>)) {
      const obj = binding.get(entity);
      if (obj && obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        obj.geometry = createGeometry(undefined);
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
    for (const entity of world.getAdded("Transform3D" as ComponentType<R>)) {
      if (shouldSkipTransform?.(entity)) continue;
      const obj = binding.get(entity);
      if (!obj) continue;
      const transform = world.getComponent(entity, "Transform3D" as ComponentType<R>) as Transform3DData | undefined;
      if (transform) applyTransform(obj, transform);
    }
    for (const entity of world.getUpdated("Transform3D" as ComponentType<R>)) {
      if (shouldSkipTransform?.(entity)) continue;
      const obj = binding.get(entity);
      if (!obj) continue;
      const transform = world.getComponent(entity, "Transform3D" as ComponentType<R>) as Transform3DData | undefined;
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

/* ------------------------------------------------------------------ */
/*  Rendering-specific asset request system wrapper                    */
/* ------------------------------------------------------------------ */

/**
 * Creates an asset request system that also updates the LoadingState resource.
 */
export function createAssetRequestSystem(
  assetManager: AssetManager,
  slots: Map<string, SlotEntry>,
  registry: Record<string, SchemaLike>,
): System<RenderRegistry> & { retryFailed(key: string): void } {
  // We need world access to set LoadingState, so we capture it via a wrapper.
  let currentWorld: World<RenderRegistry, RenderResources> | undefined;

  const generic = createGenericAssetRequestSystem<RenderRegistry>(
    assetManager,
    slots,
    registry,
    {
      onLoadingStats: (stats) => {
        if (currentWorld) {
          currentWorld.setResource("LoadingState", {
            ...stats,
            blockGameplay: stats.pending > 0,
          });
        }
      },
    },
  );

  const system = ((world: World<RenderRegistry>, dt: number, commands: Commands<RenderRegistry>) => {
    currentWorld = world as World<RenderRegistry, RenderResources>;
    generic(world, dt, commands);
    currentWorld = undefined;
  }) as System<RenderRegistry> & { retryFailed(key: string): void };

  system.retryFailed = generic.retryFailed;

  return system;
}

/**
 * Creates an asset resolve system for the rendering registry.
 */
export function createAssetResolveSystem(
  assetManager: AssetManager,
  binding: ThreeBinding<RenderRegistry>,
  slots: Map<string, SlotEntry>,
  resolver: AssetResolverImpl<RenderRegistry, ThreeBinding<RenderRegistry>>,
): System<RenderRegistry> {
  return createGenericAssetResolveSystem<RenderRegistry, ThreeBinding<RenderRegistry>>(
    assetManager,
    binding,
    slots,
    resolver,
  );
}
