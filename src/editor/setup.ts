import * as THREE from "three";
import { createWorld, EcsWorld } from "../engine/ecs/world";
import { CommandBuffer } from "../engine/ecs/commands";
import { Hierarchy } from "../engine/ecs/hierarchy";
import { renderingRegistry } from "../engine/rendering/components";
import { ThreeBinding } from "../engine/rendering/binding";
import { createRenderSyncSystem } from "../engine/rendering/systems";
import { EditorStore } from "./EditorStore";
import { GizmoManager } from "./GizmoManager";
import { EditorCameraControls } from "./EditorCameraControls";

type Registry = typeof renderingRegistry;

export type EditorSession = {
  world: EcsWorld<Registry>;
  binding: ThreeBinding<Registry>;
  hierarchy: Hierarchy<Registry>;
  store: EditorStore<Registry>;
  gizmo: GizmoManager;
  controls: EditorCameraControls;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  dispose: () => void;
};

export function createEditorSession(canvas: HTMLCanvasElement): EditorSession {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);

  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(3, 3, 5);
  camera.lookAt(0, 0.5, 0);

  const world = createWorld(renderingRegistry);
  const binding = new ThreeBinding(world);
  const hierarchy = new Hierarchy(world);
  const store = new EditorStore(world);

  // Lights
  const ambient = new THREE.AmbientLight(0x404040, 2);
  binding.scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 1.5);
  directional.position.set(5, 10, 7);
  binding.scene.add(directional);

  const gizmo = new GizmoManager(world, binding, store, camera, canvas);
  const controls = new EditorCameraControls(camera, canvas);
  controls.attach();

  const renderSync = createRenderSyncSystem(binding, {
    shouldSkipTransform: (entity) =>
      gizmo.dragging && entity === gizmo.attachedEntity,
  });
  const commands = new CommandBuffer(world);

  // Bootstrap frame — spawn initial entities
  world.beginFrame();

  const box = world.createEntity();
  world.setComponent(box, "Transform3D", {
    position: [0, 1, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  world.setComponent(box, "MeshRenderer", {
    geometry: "box",
    color: [0.9, 0.15, 0.15, 1],
  });

  const ground = world.createEntity();
  world.setComponent(ground, "Transform3D", {
    position: [0, 0, 0],
    rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    scale: [10, 10, 1],
  });
  world.setComponent(ground, "MeshRenderer", {
    geometry: "plane",
    color: [0.2, 0.7, 0.2, 1],
  });

  // Run render sync to build initial scene graph
  renderSync(world, 0, commands);
  commands.flush();
  world.endFrame();

  // RAF loop — no scheduler, just render sync + render
  let rafId = 0;
  let prevTime = performance.now();

  function loop() {
    const now = performance.now();
    const dt = (now - prevTime) / 1000;
    prevTime = now;

    controls.update(dt);
    renderSync(world, 0, commands);
    commands.flush();
    world.flushChanges();
    renderer.render(binding.scene, camera);
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  function dispose() {
    cancelAnimationFrame(rafId);
    controls.dispose();
    gizmo.dispose();
    store.dispose();
    binding.dispose();
    renderer.dispose();
  }

  return { world, binding, hierarchy, store, gizmo, controls, renderer, camera, dispose };
}
