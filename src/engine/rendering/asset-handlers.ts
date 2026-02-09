import * as THREE from "three";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import type { ComponentRegistry, World } from "../ecs/types";
import type { ThreeBinding } from "./binding";
import type { renderingRegistry } from "./components";
import type { AssetTypeHandler, SlotEntry } from "../assets/systems";
import { applyTransform } from "./systems";
import type { TextureAsset } from "./loaders/texture-loader";

type RenderRegistry = typeof renderingRegistry & ComponentRegistry;

// Concrete data shapes for typed assertions (mirrors schema-derived values)
type Transform3DData = { position: number[]; rotation: number[]; scale: number[] };

type VisualRendererData =
  | { kind: "mesh" }
  | {
      kind: "model";
      asset: { type: string; uri: string; sub?: string; options?: Record<string, unknown> };
    };

type GltfAsset = { gltf: { scene: THREE.Object3D } };

type MeshMaterialData = {
  texture: { type: string; uri: string; sub?: string; options?: Record<string, unknown> };
  color: [number, number, number, number];
};

/* ------------------------------------------------------------------ */
/*  instantiateGltf                                                   */
/* ------------------------------------------------------------------ */

function instantiateGltf(
  gltfAsset: GltfAsset,
  sub: string | undefined,
  entity: number,
  world: World<RenderRegistry>,
  binding: ThreeBinding<RenderRegistry>,
): void {
  const clone = skeletonClone(gltfAsset.gltf.scene);

  if (sub) {
    const subNode = clone.getObjectByName(sub);
    if (subNode) {
      // Hide everything
      clone.traverse((n) => {
        n.visible = false;
      });
      // Show the sub-node and its descendants
      subNode.traverse((n) => {
        n.visible = true;
      });
      // Walk up from subNode.parent to root setting visible
      let parent = subNode.parent;
      while (parent) {
        parent.visible = true;
        parent = parent.parent;
      }
    } else {
      console.warn(
        `Sub-object "${sub}" not found in glTF scene for entity ${entity}; showing full clone.`,
      );
    }
  }

  // Apply Transform3D if present
  const transform = world.getComponent(entity, "Transform3D") as Transform3DData | undefined;
  if (transform) {
    applyTransform(clone, transform);
  }

  clone.userData.entityId = entity;
  binding.set(entity, clone);
  binding.scene.add(clone);
}

/* ------------------------------------------------------------------ */
/*  Default asset type handlers                                        */
/* ------------------------------------------------------------------ */

export function createModelHandler(): AssetTypeHandler<RenderRegistry, ThreeBinding<RenderRegistry>> {
  return {
    componentType: "VisualRenderer",
    filter: (entity, world) => {
      const vr = world.getComponent(entity, "VisualRenderer") as VisualRendererData | undefined;
      return vr?.kind === "model";
    },
    onReady: (entity, asset, slot, world, binding) => {
      instantiateGltf(asset as GltfAsset, slot.sub, entity, world, binding);
    },
    onClear: (entity, _world, binding) => {
      binding.delete(entity);
    },
  };
}

export function createTextureHandler(): AssetTypeHandler<RenderRegistry, ThreeBinding<RenderRegistry>> {
  return {
    componentType: "MeshMaterial",
    onReady: (entity, asset, _slot, _world, binding) => {
      const obj = binding.get(entity);
      if (obj && obj instanceof THREE.Mesh) {
        const textureAsset = asset as TextureAsset;
        const texture = textureAsset.texture.clone();
        const mat = obj.material as THREE.MeshStandardMaterial;
        if (mat.map) mat.map.dispose();
        mat.map = texture;
        mat.needsUpdate = true;
      }
    },
    onAdded: (entity, world, binding) => {
      const obj = binding.get(entity);
      if (obj && obj instanceof THREE.Mesh) {
        const meshMat = world.getComponent(entity, "MeshMaterial" as any) as MeshMaterialData | undefined;
        if (meshMat) {
          const mat = obj.material as THREE.MeshStandardMaterial;
          mat.color.setRGB(meshMat.color[0], meshMat.color[1], meshMat.color[2]);
          mat.opacity = meshMat.color[3];
          const wasTransparent = mat.transparent;
          mat.transparent = meshMat.color[3] < 1;
          if (mat.transparent !== wasTransparent) mat.needsUpdate = true;
        }
      }
    },
    onUpdated: (entity, world, binding) => {
      const obj = binding.get(entity);
      if (obj && obj instanceof THREE.Mesh) {
        const meshMat = world.getComponent(entity, "MeshMaterial" as any) as MeshMaterialData | undefined;
        if (meshMat) {
          const mat = obj.material as THREE.MeshStandardMaterial;
          mat.color.setRGB(meshMat.color[0], meshMat.color[1], meshMat.color[2]);
          mat.opacity = meshMat.color[3];
          const wasTransparent = mat.transparent;
          mat.transparent = meshMat.color[3] < 1;
          if (mat.transparent !== wasTransparent) mat.needsUpdate = true;
        }
      }
    },
    onRemoved: (entity, _world, binding) => {
      const obj = binding.get(entity);
      if (obj && obj instanceof THREE.Mesh) {
        const mat = obj.material as THREE.MeshStandardMaterial;
        if (mat.map) {
          mat.map.dispose();
          mat.map = null;
        }
        mat.color.setRGB(0.8, 0.8, 0.8);
        mat.opacity = 1.0;
        mat.transparent = false;
        mat.needsUpdate = true;
      }
    },
  };
}
