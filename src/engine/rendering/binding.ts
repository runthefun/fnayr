import * as THREE from "three";
import type {
  EntityId,
  World,
  ComponentRegistry,
  ResourceRegistry,
} from "../ecs/types";

/**
 * Manages the mapping between ECS entities and Three.js Object3D instances.
 * Listens for entity destruction to automatically clean up scene objects.
 */
export class ThreeBinding<
  R extends ComponentRegistry,
  Res extends ResourceRegistry = {},
> {
  readonly scene: THREE.Scene;
  private readonly objectOf = new Map<EntityId, THREE.Object3D>();
  private readonly unsubscribe: () => void;

  constructor(world: World<R, Res>, scene?: THREE.Scene) {
    this.scene = scene ?? new THREE.Scene();

    this.unsubscribe = (world as any).onEntityDestroyed(
      (entity: EntityId) => {
        const obj = this.objectOf.get(entity);
        if (obj) {
          obj.removeFromParent();
          this.objectOf.delete(entity);
        }
      }
    );
  }

  get(entity: EntityId): THREE.Object3D | undefined {
    return this.objectOf.get(entity);
  }

  set(entity: EntityId, obj: THREE.Object3D): void {
    const prev = this.objectOf.get(entity);
    if (prev && prev !== obj) {
      prev.removeFromParent();
      prev.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry?.dispose();
          if (Array.isArray(node.material)) {
            node.material.forEach((m: THREE.Material) => m.dispose());
          } else {
            (node.material as THREE.Material)?.dispose();
          }
        }
      });
    }
    this.objectOf.set(entity, obj);
  }

  delete(entity: EntityId): boolean {
    const obj = this.objectOf.get(entity);
    if (obj) {
      obj.removeFromParent();
      this.objectOf.delete(entity);
      return true;
    }
    return false;
  }

  has(entity: EntityId): boolean {
    return this.objectOf.has(entity);
  }

  forEach(fn: (entity: EntityId, obj: THREE.Object3D) => void): void {
    this.objectOf.forEach((obj, entity) => fn(entity, obj));
  }

  dispose(): void {
    this.unsubscribe();
  }
}
