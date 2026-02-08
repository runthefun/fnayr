import * as THREE from "three";
import { clone as skeletonClone } from "three/addons/utils/SkeletonUtils.js";
import type { ComponentRegistry, World } from "../ecs/types";
import type { Commands } from "../ecs/commands";
import type { System } from "../ecs/systems";
import type { ThreeBinding } from "./binding";
import type { renderingRegistry } from "./components";
import { AssetManager } from "../assets/manager";
import type { SchemaLike } from "../schema";

type RenderRegistry = typeof renderingRegistry & ComponentRegistry;

export type SlotEntry = {
  key: string;
  type: string;
  uri: string;
  options?: Record<string, unknown>;
  version: number;
  sub?: string;
  status: "pending" | "active" | "failed";
  clearOnPending: boolean;
};

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
      if (world.hasComponent(entity, "ModelRenderer" as any)) continue;
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
      if (world.hasComponent(entity, "ModelRenderer" as any)) continue;
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

/* ------------------------------------------------------------------ */
/*  Schema-walking helper: find asset-ref paths in component schemas  */
/* ------------------------------------------------------------------ */

function findAssetRefPaths(
  registry: Record<string, any>,
): Map<string, string[]> {
  const result = new Map<string, string[]>();

  function walk(schema: SchemaLike, path: string[]): string[][] {
    if (schema.meta?.kind === "assetRef") return [path];
    if (schema.type === "object") {
      const obj = schema as unknown as { properties: Record<string, SchemaLike> };
      const found: string[][] = [];
      for (const [key, propSchema] of Object.entries(obj.properties)) {
        found.push(...walk(propSchema, [...path, key]));
      }
      return found;
    }
    if (schema.type === "optional") {
      const opt = schema as unknown as { inner: SchemaLike };
      return walk(opt.inner, path);
    }
    // Skip array, tuple, map, taggedUnion
    return [];
  }

  for (const [componentType, schema] of Object.entries(registry)) {
    const paths = walk(schema as SchemaLike, []);
    if (paths.length > 1) {
      throw new Error(
        `Multiple AssetRef fields per component not yet supported: ${componentType}`,
      );
    }
    if (paths.length === 1) {
      result.set(componentType, paths[0]);
    }
  }
  return result;
}

function getNestedValue(obj: any, path: string[]): any {
  let current = obj;
  for (const key of path) {
    if (current == null) return undefined;
    current = current[key];
  }
  return current;
}

/* ------------------------------------------------------------------ */
/*  createAssetRequestSystem                                          */
/* ------------------------------------------------------------------ */

export function createAssetRequestSystem(
  assetManager: AssetManager,
  slots: Map<string, SlotEntry>,
  registry: Record<string, any>,
): System<RenderRegistry> & { retryFailed(key: string): void } {
  // Pre-compute asset-ref paths per component type
  const assetRefPaths = findAssetRefPaths(registry);

  function slotKey(entity: number, componentType: string): string {
    return `${entity}:${componentType}`;
  }

  function extractRef(
    entity: number,
    componentType: string,
    world: World<RenderRegistry>,
  ): { type: string; uri: string; sub?: string; options?: Record<string, unknown> } | undefined {
    const path = assetRefPaths.get(componentType);
    if (!path) return undefined;
    const component = world.getComponent(entity, componentType as any) as any;
    if (!component) return undefined;
    const ref = getNestedValue(component, path);
    if (!ref) return undefined;
    return ref as { type: string; uri: string; sub?: string; options?: Record<string, unknown> };
  }

  function handleAdded(
    entity: number,
    componentType: string,
    world: World<RenderRegistry>,
  ): void {
    const ref = extractRef(entity, componentType, world);
    if (!ref) return;
    const sk = slotKey(entity, componentType);

    if (!ref.uri) {
      // Empty URI on add: skip (no slot created)
      return;
    }

    if (!assetManager.hasLoader(ref.type)) {
      console.warn(
        `No loader registered for asset type "${ref.type}" (entity ${entity}, component ${componentType})`,
      );
      slots.set(sk, {
        key: "",
        type: ref.type,
        uri: ref.uri,
        options: ref.options,
        version: 0,
        sub: ref.sub,
        status: "failed",
        clearOnPending: false,
      });
      return;
    }

    const cacheKey = AssetManager.cacheKey(ref.type, ref.uri);
    const entry = assetManager.request(ref.type, ref.uri, ref.options);
    slots.set(sk, {
      key: cacheKey,
      type: ref.type,
      uri: ref.uri,
      options: ref.options,
      version: 0,
      sub: ref.sub,
      status: entry.status === "error" ? "failed" : "pending",
      clearOnPending: false,
    });
  }

  function handleUpdated(
    entity: number,
    componentType: string,
    world: World<RenderRegistry>,
    emptyUriCleanup: Set<string>,
  ): void {
    const ref = extractRef(entity, componentType, world);
    if (!ref) return;
    const sk = slotKey(entity, componentType);
    const existing = slots.get(sk);

    // No existing slot → treat like getAdded
    if (!existing) {
      handleAdded(entity, componentType, world);
      return;
    }

    // URI became empty → schedule cleanup
    if (!ref.uri) {
      emptyUriCleanup.add(sk);
      return;
    }

    const newCacheKey = assetManager.hasLoader(ref.type)
      ? AssetManager.cacheKey(ref.type, ref.uri)
      : "";

    // Branch A: cache key changed
    if (newCacheKey !== existing.key) {
      if (existing.key !== "") {
        assetManager.release(existing.key);
      }
      if (!assetManager.hasLoader(ref.type)) {
        console.warn(
          `No loader registered for asset type "${ref.type}" (entity ${entity}, component ${componentType})`,
        );
        existing.key = "";
        existing.type = ref.type;
        existing.uri = ref.uri;
        existing.options = ref.options;
        existing.sub = ref.sub;
        existing.status = "failed";
        existing.version++;
        existing.clearOnPending = false;
        return;
      }
      const wasActive = existing.status === "active";
      const entry = assetManager.request(ref.type, ref.uri, ref.options);
      existing.key = newCacheKey;
      existing.type = ref.type;
      existing.uri = ref.uri;
      existing.options = ref.options;
      existing.sub = ref.sub;
      existing.status = entry.status === "error" ? "failed" : "pending";
      existing.version++;
      existing.clearOnPending = wasActive;
      return;
    }

    // Branch B: same key, sub changed
    if (ref.sub !== existing.sub) {
      existing.sub = ref.sub;
      if (existing.status === "active") {
        existing.status = "pending";
        existing.version++;
        existing.clearOnPending = true;
      }
      return;
    }

    // Branch C: same key+sub, peek missing due to invalidate
    if (existing.key !== "" && !assetManager.peek(existing.key)) {
      assetManager.request(ref.type, ref.uri, ref.options);
      existing.status = "pending";
      existing.version++;
      existing.clearOnPending = false;
      return;
    }

    // Branch D: same key+sub, cache exists or key==""
    if (existing.key === "") {
      // Re-check if loader became available
      if (assetManager.hasLoader(ref.type)) {
        const ck = AssetManager.cacheKey(ref.type, ref.uri);
        assetManager.request(ref.type, ref.uri, ref.options);
        existing.key = ck;
        existing.status = "pending";
        existing.version++;
        existing.clearOnPending = false;
      } else {
        // Still no loader — update tracked metadata if URI/options/sub changed
        const uriChanged = ref.uri !== existing.uri;
        const subChanged = ref.sub !== existing.sub;
        if (uriChanged || subChanged) {
          existing.uri = ref.uri;
          existing.options = ref.options;
          existing.sub = ref.sub;
          existing.type = ref.type;
          existing.version++;
        }
      }
    }
  }

  const system = ((world: World<RenderRegistry>, _dt: number, _commands: Commands<RenderRegistry>) => {
    const emptyUriCleanup = new Set<string>();

    // Process each asset-bearing component type
    for (const componentType of assetRefPaths.keys()) {
      // Handle added
      for (const entity of world.getAdded(componentType as any)) {
        handleAdded(entity, componentType, world);
      }

      // Handle updated
      for (const entity of world.getUpdated(componentType as any)) {
        handleUpdated(entity, componentType, world, emptyUriCleanup);
      }

      // Handle removed
      for (const entity of world.getRemoved(componentType as any)) {
        const sk = slotKey(entity, componentType);
        const slot = slots.get(sk);
        if (slot) {
          if (slot.key !== "") {
            assetManager.release(slot.key);
          }
          slots.delete(sk);
        }
      }
    }

    // Empty-URI cleanup pass
    for (const sk of emptyUriCleanup) {
      const slot = slots.get(sk);
      if (slot) {
        if (slot.key !== "") {
          assetManager.release(slot.key);
        }
        slots.delete(sk);
      }
    }

    // Dead-entity prune
    for (const [sk, slot] of slots) {
      const entityId = parseInt(sk.split(":")[0], 10);
      if (!world.isAlive(entityId)) {
        if (slot.key !== "") {
          assetManager.release(slot.key);
        }
        slots.delete(sk);
      }
    }

    // Update LoadingState resource
    let pending = 0;
    let ready = 0;
    let failed = 0;
    for (const slot of slots.values()) {
      switch (slot.status) {
        case "pending":
          pending++;
          break;
        case "active":
          ready++;
          break;
        case "failed":
          failed++;
          break;
      }
    }
    const total = slots.size;
    (world as any).setResource("LoadingState", {
      pending,
      ready,
      failed,
      total,
      blockGameplay: pending > 0,
    });
  }) as System<RenderRegistry> & { retryFailed(key: string): void };

  system.retryFailed = (key: string) => {
    assetManager.invalidate(key);
    for (const [, slot] of slots) {
      if (slot.status !== "failed") continue;
      const matches =
        slot.key === key ||
        (slot.key === "" && AssetManager.cacheKey(slot.type, slot.uri) === key);
      if (matches && assetManager.hasLoader(slot.type)) {
        const ck = AssetManager.cacheKey(slot.type, slot.uri);
        assetManager.request(slot.type, slot.uri, slot.options);
        slot.key = ck;
        slot.status = "pending";
        slot.version++;
      }
    }
  };

  return system;
}

/* ------------------------------------------------------------------ */
/*  instantiateGltf                                                   */
/* ------------------------------------------------------------------ */

function instantiateGltf(
  gltfAsset: { gltf: { scene: THREE.Object3D } },
  sub: string | undefined,
  entity: number,
  world: World<any>,
  binding: ThreeBinding<any>,
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
  const transform = world.getComponent(entity, "Transform3D" as any) as any;
  if (transform) {
    applyTransform(clone, transform);
  }

  clone.userData.entityId = entity;
  binding.set(entity, clone);
  binding.scene.add(clone);
}

/* ------------------------------------------------------------------ */
/*  createModelResolveSystem                                          */
/* ------------------------------------------------------------------ */

export function createModelResolveSystem(
  assetManager: AssetManager,
  binding: ThreeBinding<any>,
  slots: Map<string, SlotEntry>,
): System<RenderRegistry> {
  return (world: World<RenderRegistry>, _dt: number, _commands: Commands<RenderRegistry>) => {
    // 1. Empty-URI cleanup: updated ModelRenderer with empty URI
    for (const entity of world.getUpdated("ModelRenderer" as any)) {
      const mr = world.getComponent(entity, "ModelRenderer" as any) as any;
      if (mr && !mr.asset?.uri && binding.has(entity)) {
        binding.delete(entity);
      }
    }

    // 2. Model-removal cleanup
    for (const entity of world.getRemoved("ModelRenderer" as any)) {
      if (binding.has(entity)) {
        binding.delete(entity);
      }
    }

    // 3. Pre-clear pass: slots with pending + clearOnPending
    for (const [sk, slot] of slots) {
      if (slot.status === "pending" && slot.clearOnPending) {
        const entityId = parseInt(sk.split(":")[0], 10);
        if (!world.isAlive(entityId) || !world.hasComponent(entityId, "ModelRenderer" as any)) continue;
        binding.delete(entityId);
        slot.clearOnPending = false;
      }
    }

    // 4. Path A: newly ready assets
    const justReady = assetManager.drainReady();
    if (justReady.size > 0) {
      for (const [sk, slot] of slots) {
        if (slot.status !== "pending") continue;
        if (!justReady.has(slot.key)) continue;
        const entityId = parseInt(sk.split(":")[0], 10);
        if (!world.isAlive(entityId) || !world.hasComponent(entityId, "ModelRenderer" as any)) continue;
        const entry = assetManager.peek(slot.key);
        if (entry && entry.status === "ready") {
          instantiateGltf(entry.asset as any, slot.sub, entityId, world, binding);
          slot.status = "active";
        }
      }
    }

    // 5. Path B: cache hits — pending slots whose assets are already ready
    for (const [sk, slot] of slots) {
      if (slot.status !== "pending") continue;
      const entityId = parseInt(sk.split(":")[0], 10);
      if (!world.isAlive(entityId) || !world.hasComponent(entityId, "ModelRenderer" as any)) continue;
      const entry = assetManager.peek(slot.key);
      if (entry && entry.status === "ready") {
        instantiateGltf(entry.asset as any, slot.sub, entityId, world, binding);
        slot.status = "active";
      }
    }

    // 6. Path C: failed assets
    const justFailed = assetManager.drainFailed();
    if (justFailed.size > 0) {
      for (const [, slot] of slots) {
        if (slot.status !== "pending") continue;
        if (justFailed.has(slot.key)) {
          slot.status = "failed";
        }
      }
    }
  };
}
