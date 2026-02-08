import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { EcsWorld } from "../engine/ecs/world";
import type { ThreeBinding } from "../engine/rendering/binding";
import type { EditorStore } from "./EditorStore";
import type { renderingRegistry } from "../engine/rendering/components";

type Registry = typeof renderingRegistry;

export class GizmoManager {
  private controls: TransformControls;
  private _attachedEntity: number | null = null;
  private _dragging = false;
  private unsubSelection: () => void;

  /** Called when dragging state changes — set by Viewport to suppress orbit. */
  onDraggingChanged: ((dragging: boolean) => void) | null = null;

  constructor(
    private world: EcsWorld<Registry>,
    private binding: ThreeBinding<Registry>,
    private store: EditorStore<Registry>,
    camera: THREE.Camera,
    domElement: HTMLElement
  ) {
    this.controls = new TransformControls(camera, domElement);
    this.controls.setSize(0.75);
    binding.scene.add(this.controls.getHelper());

    this.controls.addEventListener("dragging-changed", (event: any) => {
      this._dragging = event.value;
      this.onDraggingChanged?.(this._dragging);
    });

    this.controls.addEventListener("objectChange", () => {
      if (this._attachedEntity == null) return;
      const obj = this.controls.object;
      if (!obj) return;

      const pos = obj.position;
      const rot = obj.quaternion;
      const scl = obj.scale;

      this.world.setComponent(this._attachedEntity as any, "Transform3D" as any, {
        position: [pos.x, pos.y, pos.z],
        rotation: [rot.x, rot.y, rot.z, rot.w],
        scale: [scl.x, scl.y, scl.z],
      } as any);
    });

    this.unsubSelection = store.subscribeSelection(() => {
      this.syncToSelection();
    });
    this.syncToSelection();
  }

  get dragging(): boolean {
    return this._dragging;
  }

  get attachedEntity(): number | null {
    return this._attachedEntity;
  }

  setMode(mode: "translate" | "rotate" | "scale"): void {
    this.controls.setMode(mode);
  }

  dispose(): void {
    this.unsubSelection();
    this.controls.detach();
    const helper = this.controls.getHelper();
    helper.removeFromParent();
    this.controls.dispose();
  }

  /** Re-check that the attached object is still valid. Call once per frame. */
  tick(): void {
    if (this._attachedEntity == null) {
      // An entity may be selected but not yet attached (e.g. async model load).
      if (this.store.getSelectedEntity() != null) {
        this.syncToSelection();
      }
      return;
    }
    const obj = this.binding.get(this._attachedEntity);
    if (obj && obj === this.controls.object) return;
    this.syncToSelection();
  }

  private syncToSelection(): void {
    const entity = this.store.getSelectedEntity();
    if (entity == null) {
      this.controls.detach();
      this._attachedEntity = null;
      return;
    }

    const obj = this.binding.get(entity);
    if (!obj) {
      this.controls.detach();
      this._attachedEntity = null;
      return;
    }

    this.controls.attach(obj);
    this._attachedEntity = entity;
  }
}
