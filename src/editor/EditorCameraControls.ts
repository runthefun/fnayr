import * as THREE from "three";

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

export class EditorCameraControls {
  target = new THREE.Vector3(0, 0.5, 0);

  private spherical = new THREE.Spherical();
  private keyStates = new Set<string>();
  private _dragging = false;
  private panMode = false;
  enabled = true;

  private moveSpeed = 5;
  private orbitSensitivity = 0.003;
  private panSensitivity = 0.005;
  private minRadius = 0.5;
  private maxRadius = 100;
  private minPhi = 0.1;
  private maxPhi = Math.PI - 0.1;

  private pointerId: number | null = null;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private domElement: HTMLCanvasElement,
  ) {
    // Initialise spherical from current camera position relative to target
    _v.copy(camera.position).sub(this.target);
    this.spherical.setFromVector3(_v);
  }

  get dragging() {
    return this._dragging;
  }

  // --- DOM handlers ---

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled) return;
    // Only orbit/pan on right (2) or middle (1) button
    if (e.button !== 2 && e.button !== 1) return;

    this._dragging = true;
    this.panMode = e.button === 1 || e.shiftKey;
    this.pointerId = e.pointerId;
    this.domElement.setPointerCapture(e.pointerId);
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this._dragging || e.pointerId !== this.pointerId) return;

    if (this.panMode) {
      // Pan: move target in camera-local XY plane
      const right = new THREE.Vector3();
      const up = new THREE.Vector3();
      this.camera.getWorldDirection(_v);
      right.crossVectors(_v, this.camera.up).normalize();
      up.crossVectors(right, _v).normalize();

      const scale = this.panSensitivity * this.spherical.radius;
      this.target.addScaledVector(right, -e.movementX * scale);
      this.target.addScaledVector(up, e.movementY * scale);
    } else {
      // Orbit: adjust spherical angles
      this.spherical.theta -= e.movementX * this.orbitSensitivity;
      this.spherical.phi -= e.movementY * this.orbitSensitivity;
      this.spherical.phi = Math.max(
        this.minPhi,
        Math.min(this.maxPhi, this.spherical.phi),
      );
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button !== 2 && e.button !== 1) return;
    this._dragging = false;
    this.panMode = false;
    if (this.pointerId !== null) {
      this.domElement.releasePointerCapture(this.pointerId);
      this.pointerId = null;
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.spherical.radius *= 1 + e.deltaY * 0.001;
    this.spherical.radius = Math.max(
      this.minRadius,
      Math.min(this.maxRadius, this.spherical.radius),
    );
  };

  private onContextMenu = (e: Event) => {
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement
    )
      return;
    this.keyStates.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keyStates.delete(e.code);
  };

  // --- Update loop ---

  update(dt: number) {
    if (!this.enabled) return;

    // WASD movement
    const speed =
      this.moveSpeed *
      dt *
      (this.keyStates.has("ShiftLeft") || this.keyStates.has("ShiftRight")
        ? 2
        : 1);

    if (speed > 0) {
      // forward/back: camera forward projected onto XZ plane
      this.camera.getWorldDirection(_v);
      _v.y = 0;
      _v.normalize();

      // right vector
      _v2.crossVectors(_v, this.camera.up).normalize();

      if (this.keyStates.has("KeyW") || this.keyStates.has("ArrowUp")) {
        this.target.addScaledVector(_v, speed);
      }
      if (this.keyStates.has("KeyS") || this.keyStates.has("ArrowDown")) {
        this.target.addScaledVector(_v, -speed);
      }
      if (this.keyStates.has("KeyA") || this.keyStates.has("ArrowLeft")) {
        this.target.addScaledVector(_v2, -speed);
      }
      if (this.keyStates.has("KeyD") || this.keyStates.has("ArrowRight")) {
        this.target.addScaledVector(_v2, speed);
      }
      if (this.keyStates.has("Space")) {
        this.target.y += speed;
      }
      if (this.keyStates.has("KeyB")) {
        this.target.y -= speed;
      }
    }

    // Apply spherical → camera position
    _v.setFromSpherical(this.spherical);
    this.camera.position.copy(this.target).add(_v);
    this.camera.lookAt(this.target);
  }

  /** Snap the camera to frame the given object. */
  focusOnObject(obj: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(obj);

    if (box.isEmpty()) {
      // No geometry (e.g. lights) — use the object's world position directly
      obj.getWorldPosition(this.target);
      this.spherical.radius = 2;
    } else {
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      this.target.copy(sphere.center);
      this.spherical.radius = Math.max(
        this.minRadius,
        sphere.radius * 2.5,
      );
    }
  }

  // --- Lifecycle ---

  attach() {
    const el = this.domElement;
    el.addEventListener("pointerdown", this.onPointerDown);
    el.addEventListener("pointermove", this.onPointerMove);
    el.addEventListener("pointerup", this.onPointerUp);
    el.addEventListener("wheel", this.onWheel, { passive: false });
    el.addEventListener("contextmenu", this.onContextMenu);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
  }

  dispose() {
    const el = this.domElement;
    el.removeEventListener("pointerdown", this.onPointerDown);
    el.removeEventListener("pointermove", this.onPointerMove);
    el.removeEventListener("pointerup", this.onPointerUp);
    el.removeEventListener("wheel", this.onWheel);
    el.removeEventListener("contextmenu", this.onContextMenu);
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
  }
}
