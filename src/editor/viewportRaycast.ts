import * as THREE from "three";
import type { ThreeBinding } from "../engine/rendering/binding";
import type { ComponentRegistry } from "../engine/ecs/types";

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/**
 * Raycast into the scene and return the entityId of the first hit mesh, or null.
 */
export function pickEntity<R extends ComponentRegistry>(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  binding: ThreeBinding<R>
): number | null {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const intersects = raycaster.intersectObjects(binding.scene.children, true);

  for (const hit of intersects) {
    let obj: THREE.Object3D | null = hit.object;
    while (obj) {
      if (obj.userData.entityId != null) {
        return obj.userData.entityId as number;
      }
      obj = obj.parent;
    }
  }

  return null;
}
