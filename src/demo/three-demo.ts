import * as THREE from "three";
import type { World } from "../engine/ecs/types";
import { createWorld } from "../engine/ecs/world";
import { Scheduler } from "../engine/ecs/systems";
import { CommandBuffer } from "../engine/ecs/commands";
import { renderingRegistry } from "../engine/rendering/components";
import { ThreeBinding } from "../engine/rendering/binding";
import { createRenderSyncSystem } from "../engine/rendering/systems";
import { InputBinding } from "../engine/input/input";
import { createInputSystem } from "../engine/input/systems";

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

// --- Input ---

const input = new InputBinding(window);

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

const scheduler = new Scheduler(world, ["input", "update", "render"]);

// Input system — polls the binding once per frame
scheduler.addSystem("input", createInputSystem<Registry>(input));

// Movement system — WASD moves the box on the XZ plane
const MOVE_SPEED = 4;
const movementSystem = (w: World<Registry>, dt: number) => {
  for (const { entity } of w.query(["Spin", "Transform3D"])) {
    const transform = w.getMut(entity, "Transform3D")!;
    const pos = [...transform.position] as [number, number, number];

    if (input.isKeyDown("KeyW") || input.isKeyDown("ArrowUp")) pos[2] -= MOVE_SPEED * dt;
    if (input.isKeyDown("KeyS") || input.isKeyDown("ArrowDown")) pos[2] += MOVE_SPEED * dt;
    if (input.isKeyDown("KeyA") || input.isKeyDown("ArrowLeft")) pos[0] -= MOVE_SPEED * dt;
    if (input.isKeyDown("KeyD") || input.isKeyDown("ArrowRight")) pos[0] += MOVE_SPEED * dt;

    transform.position = pos;
  }
};

// Camera orbit system — right-click drag orbits the camera around the origin
let orbitYaw = Math.atan2(camera.position.x, camera.position.z);
let orbitPitch = Math.asin(camera.position.y / camera.position.length());
const orbitRadius = camera.position.length();
const ORBIT_SENSITIVITY = 0.003;

const cameraSystem = () => {
  if (input.mouse.buttons[2].down || input.mouse.buttons[0].down) {
    orbitYaw -= input.mouse.dx * ORBIT_SENSITIVITY;
    orbitPitch += input.mouse.dy * ORBIT_SENSITIVITY;
    orbitPitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, orbitPitch));
  }

  // Scroll to zoom
  if (input.mouse.scrollY !== 0) {
    const zoomFactor = 1 + input.mouse.scrollY * 0.001;
    camera.position.multiplyScalar(Math.max(0.5, Math.min(zoomFactor, 2)));
  }

  camera.position.set(
    orbitRadius * Math.cos(orbitPitch) * Math.sin(orbitYaw),
    orbitRadius * Math.sin(orbitPitch),
    orbitRadius * Math.cos(orbitPitch) * Math.cos(orbitYaw)
  );
  camera.lookAt(0, 0.5, 0);
};

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

// Color cycle system — Space toggles the box color
let colorIndex = 0;
const COLORS: [number, number, number, number][] = [
  [0.9, 0.15, 0.15, 1],
  [0.15, 0.5, 0.9, 1],
  [0.9, 0.8, 0.1, 1],
  [0.8, 0.2, 0.8, 1],
];

const colorCycleSystem = (w: World<Registry>) => {
  if (!input.isKeyJustPressed("Space")) return;
  colorIndex = (colorIndex + 1) % COLORS.length;
  for (const { entity } of w.query(["Spin", "MeshMaterial"])) {
    const mat = w.getMut(entity, "MeshMaterial")! as any;
    mat.color = COLORS[colorIndex];
  }
};

const renderSync = createRenderSyncSystem(binding);

scheduler.addSystem("update", movementSystem);
scheduler.addSystem("update", spinSystem);
scheduler.addSystem("update", colorCycleSystem);
scheduler.addSystem("update", cameraSystem);
scheduler.addSystem("render", renderSync);

// --- Spawn Entities (inside a bootstrap frame so change tracking picks them up) ---

world.beginFrame();

// Red spinning box
const box = world.createEntity();
world.setComponent(box, "Transform3D", {
  position: [0, 1, 0],
  rotation: [0, 0, 0, 1],
  scale: [1, 1, 1],
});
world.setComponent(box, "VisualRenderer", {
  kind: "mesh",
  geometry: "box",
});
world.setComponent(box, "MeshMaterial", {
  texture: { kind: "asset", type: "texture", uri: "" },
  color: [0.9, 0.15, 0.15, 1],
});
world.setComponent(box, "Spin", { speed: 1 });

// Green ground plane
const ground = world.createEntity();
world.setComponent(ground, "Transform3D", {
  position: [0, 0, 0],
  rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], // rotate -90deg around X
  scale: [10, 10, 1],
});
world.setComponent(ground, "VisualRenderer", {
  kind: "mesh",
  geometry: "plane",
});
world.setComponent(ground, "MeshMaterial", {
  texture: { kind: "asset", type: "texture", uri: "" },
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
