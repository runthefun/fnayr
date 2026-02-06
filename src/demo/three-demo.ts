import * as THREE from "three";
import type { World } from "../engine/ecs/types";
import { createWorld } from "../engine/ecs/world";
import { Scheduler } from "../engine/ecs/systems";
import { CommandBuffer } from "../engine/ecs/commands";
import { renderingRegistry } from "../engine/rendering/components";
import { ThreeBinding } from "../engine/rendering/binding";
import { createRenderSyncSystem } from "../engine/rendering/systems";

type Registry = typeof renderingRegistry;

// --- Renderer & Camera ---

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  100
);
camera.position.set(3, 3, 5);
camera.lookAt(0, 0.5, 0);

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- ECS World ---

const world = createWorld(renderingRegistry);
const binding = new ThreeBinding(world);

// Lights
const ambient = new THREE.AmbientLight(0x404040, 2);
binding.scene.add(ambient);
const directional = new THREE.DirectionalLight(0xffffff, 1.5);
directional.position.set(5, 10, 7);
binding.scene.add(directional);

// --- Systems ---

const scheduler = new Scheduler(world, ["update", "render"]);

// Spin system — rotates entities with the Spin component
const spinSystem = (
  w: World<Registry>,
  dt: number,
) => {
  for (const { entity, components } of w.query(["Spin", "Transform3D"])) {
    const transform = w.getMut(entity, "Transform3D")!;
    const speed = components.Spin.speed;

    // Apply rotation around Y axis
    const angle = speed * dt;
    const halfAngle = angle / 2;
    const sinHalf = Math.sin(halfAngle);
    const cosHalf = Math.cos(halfAngle);

    // Current quaternion
    const [qx, qy, qz, qw] = transform.rotation;
    // Delta quaternion (rotation around Y)
    const dx = 0, dy = sinHalf, dz = 0, dw = cosHalf;
    // Multiply: current * delta
    transform.rotation = [
      qw * dx + qx * dw + qy * dz - qz * dy,
      qw * dy - qx * dz + qy * dw + qz * dx,
      qw * dz + qx * dy - qy * dx + qz * dw,
      qw * dw - qx * dx - qy * dy - qz * dz,
    ];
  }
};

const renderSync = createRenderSyncSystem(binding);
scheduler.addSystem("update", spinSystem);
scheduler.addSystem("render", renderSync);

// --- Spawn Entities (inside a bootstrap frame so change tracking picks them up) ---

world.beginFrame();

// Red spinning box
const box = world.createEntity();
world.addComponent(box, "Transform3D", {
  position: [0, 1, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});
world.addComponent(box, "MeshRenderer", {
  geometry: "box",
  color: [0.9, 0.15, 0.15, 1],
});
world.addComponent(box, "Spin", { speed: 1 });

// Green ground plane
const ground = world.createEntity();
world.addComponent(ground, "Transform3D", {
  position: [0, 0, 0],
  rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], // rotate -90deg around X
  scale: [10, 10, 1],
});
world.addComponent(ground, "MeshRenderer", {
  geometry: "plane",
  color: [0.2, 0.7, 0.2, 1],
});

// Run the render sync manually to build the initial scene graph
const bootstrapCmds = new CommandBuffer(world);
renderSync(world, 0, bootstrapCmds);
bootstrapCmds.flush();
world.endFrame();

// --- Game Loop ---

let lastTime = performance.now();

function loop(now: number) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  scheduler.runFrame(dt);
  renderer.render(binding.scene, camera);

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
