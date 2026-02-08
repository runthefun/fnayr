import * as THREE from "three";
import { createWorld, EcsWorld } from "../engine/ecs/world";
import { CommandBuffer } from "../engine/ecs/commands";
import { Hierarchy } from "../engine/ecs/hierarchy";
import { renderingRegistry, renderingResources } from "../engine/rendering/components";
import { ThreeBinding } from "../engine/rendering/binding";
import { createRenderSyncSystem, createTransformSyncSystem, createAssetRequestSystem, createModelResolveSystem } from "../engine/rendering/systems";
import type { SlotEntry } from "../engine/rendering/systems";
import { createLightSyncSystem, createBackgroundSyncSystem } from "../engine/rendering/lights";
import { GltfAssetLoader } from "../engine/rendering/loaders";
import { AssetManager } from "../engine/assets";
import { EDITOR_LAYER } from "../engine/rendering/constants";
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
  camera.layers.enable(EDITOR_LAYER);

  const world = createWorld(renderingRegistry, { resources: renderingResources });
  const binding = new ThreeBinding(world);
  const hierarchy = new Hierarchy(world);
  const store = new EditorStore(world);

  // Asset pipeline
  const assetManager = new AssetManager();
  assetManager.registerLoader("glb", new GltfAssetLoader());
  const slots: Map<string, SlotEntry> = new Map();

  const gizmo = new GizmoManager(world, binding, store, camera, canvas);
  const controls = new EditorCameraControls(camera, canvas);
  controls.attach();

  const renderSync = createRenderSyncSystem(binding);
  const assetRequestSync = createAssetRequestSystem(assetManager, slots, renderingRegistry);
  const modelResolveSync = createModelResolveSystem(assetManager, binding, slots);
  const lightSync = createLightSyncSystem(binding.scene, binding);
  const backgroundSync = createBackgroundSyncSystem(binding.scene);
  const transformSync = createTransformSyncSystem(binding, {
    shouldSkipTransform: (entity) =>
      gizmo.dragging && entity === gizmo.attachedEntity,
    hierarchy,
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
  world.setComponent(box, "VisualRenderer", {
    kind: "mesh",
    geometry: "box",
    color: [0.9, 0.15, 0.15, 1],
  });

  const ground = world.createEntity();
  world.setComponent(ground, "Transform3D", {
    position: [0, 0, 0],
    rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2],
    scale: [10, 10, 1],
  });
  world.setComponent(ground, "VisualRenderer", {
    kind: "mesh",
    geometry: "plane",
    color: [0.2, 0.7, 0.2, 1],
  });

  // Lights as ECS entities
  const ambientEntity = world.createEntity();
  world.setComponent(ambientEntity, "AmbientLight", {
    color: [0.25, 0.25, 0.25, 1],
    intensity: 2,
  });

  const dirLightEntity = world.createEntity();
  world.setComponent(dirLightEntity, "Transform3D", {
    position: [5, 10, 7],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
  });
  world.setComponent(dirLightEntity, "DirectionalLight", {
    color: [1, 1, 1, 1],
    intensity: 1.5,
  });

  const bgEntity = world.createEntity();
  world.setComponent(bgEntity, "Background", {
    color: [0.53, 0.81, 0.92, 1],
    intensity: 1,
    blurriness: 0,
  });

  // Run sync systems to build initial scene graph
  renderSync(world, 0, commands);
  assetRequestSync(world as any, 0, commands as any);
  modelResolveSync(world as any, 0, commands as any);
  lightSync(world, 0, commands);
  backgroundSync(world, 0, commands);
  transformSync(world, 0, commands);
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
    assetRequestSync(world as any, 0, commands as any);
    modelResolveSync(world as any, 0, commands as any);
    lightSync(world, 0, commands);
    backgroundSync(world, 0, commands);
    transformSync(world, 0, commands);
    commands.flush();
    gizmo.tick();
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
    assetManager.dispose();
    binding.dispose();
    renderer.dispose();
  }

  return { world, binding, hierarchy, store, gizmo, controls, renderer, camera, dispose };
}
