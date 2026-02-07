import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { createWorld } from "../ecs/world";
import { renderingRegistry } from "./components";
import { ThreeBinding } from "./binding";
import { CommandBuffer } from "../ecs/commands";
import { createLightSyncSystem } from "./lights";
import { createTransformSyncSystem } from "./systems";
import { EDITOR_LAYER } from "./constants";

type R = typeof renderingRegistry;

function setup() {
  const world = createWorld(renderingRegistry);
  const binding = new ThreeBinding(world);
  const commands = new CommandBuffer(world);
  const lightSync = createLightSyncSystem(binding);
  const transformSync = createTransformSyncSystem(binding);
  return { world, binding, commands, lightSync, transformSync };
}

function runFrame(ctx: ReturnType<typeof setup>, fn?: () => void) {
  ctx.world.beginFrame();
  fn?.();
  ctx.lightSync(ctx.world, 0, ctx.commands);
  ctx.transformSync(ctx.world, 0, ctx.commands);
  ctx.commands.flush();
  ctx.world.endFrame();
}

describe("Light sync system", () => {
  it("DirectionalLight added → THREE.DirectionalLight appears in scene", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "DirectionalLight", {
        color: [1, 1, 1, 1],
        intensity: 1.5,
      });
    });

    const light = ctx.binding.get(entity);
    expect(light).toBeInstanceOf(THREE.DirectionalLight);
    expect((light as THREE.DirectionalLight).intensity).toBe(1.5);
    expect((light as THREE.DirectionalLight).color.r).toBe(1);
    expect((light as THREE.DirectionalLight).color.g).toBe(1);
    expect((light as THREE.DirectionalLight).color.b).toBe(1);
  });

  it("DirectionalLight has a DirectionalLightHelper on the editor layer", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "DirectionalLight");
    });

    const helper = ctx.binding.scene.children.find(
      (c) => c instanceof THREE.DirectionalLightHelper
    );
    expect(helper).toBeInstanceOf(THREE.DirectionalLightHelper);
    expect(helper!.userData.entityId).toBe(entity);
    expect(helper!.layers.isEnabled(EDITOR_LAYER)).toBe(true);
    expect(helper!.layers.isEnabled(0)).toBe(false);
  });

  it("AmbientLight added → THREE.AmbientLight appears in scene", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "AmbientLight", {
        color: [0.25, 0.25, 0.25, 1],
        intensity: 2,
      });
    });

    const light = ctx.binding.get(entity);
    expect(light).toBeInstanceOf(THREE.AmbientLight);
    expect((light as THREE.AmbientLight).intensity).toBe(2);
    expect((light as THREE.AmbientLight).color.r).toBeCloseTo(0.25);
    expect((light as THREE.AmbientLight).color.g).toBeCloseTo(0.25);
    expect((light as THREE.AmbientLight).color.b).toBeCloseTo(0.25);
  });

  it("AmbientLight has no helper in the scene", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "AmbientLight");
    });

    const helpers = ctx.binding.scene.children.filter(
      (c) =>
        c instanceof THREE.DirectionalLightHelper ||
        c instanceof THREE.PointLightHelper
    );
    expect(helpers).toHaveLength(0);
  });

  it("PointLight added → THREE.PointLight appears in scene", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "PointLight", {
        color: [1, 0.5, 0, 1],
        intensity: 3,
        distance: 10,
        decay: 1,
      });
    });

    const light = ctx.binding.get(entity) as THREE.PointLight;
    expect(light).toBeInstanceOf(THREE.PointLight);
    expect(light.intensity).toBe(3);
    expect(light.distance).toBe(10);
    expect(light.decay).toBe(1);
    expect(light.color.r).toBe(1);
    expect(light.color.g).toBeCloseTo(0.5);
    expect(light.color.b).toBe(0);
  });

  it("PointLight has a PointLightHelper on the editor layer", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "PointLight");
    });

    const helper = ctx.binding.scene.children.find(
      (c) => c instanceof THREE.PointLightHelper
    );
    expect(helper).toBeInstanceOf(THREE.PointLightHelper);
    expect(helper!.userData.entityId).toBe(entity);
    expect(helper!.layers.isEnabled(EDITOR_LAYER)).toBe(true);
    expect(helper!.layers.isEnabled(0)).toBe(false);
  });

  it("updating DirectionalLight properties syncs to Three.js", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "DirectionalLight", {
        color: [1, 1, 1, 1],
        intensity: 1,
      });
    });

    const light = ctx.binding.get(entity) as THREE.DirectionalLight;
    expect(light.intensity).toBe(1);

    runFrame(ctx, () => {
      const data = ctx.world.getMut(entity, "DirectionalLight")!;
      data.color = [1, 0, 0, 1];
      data.intensity = 2.5;
    });

    expect(light.intensity).toBe(2.5);
    expect(light.color.r).toBe(1);
    expect(light.color.g).toBe(0);
    expect(light.color.b).toBe(0);
  });

  it("updating AmbientLight properties syncs to Three.js", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "AmbientLight", {
        color: [0.5, 0.5, 0.5, 1],
        intensity: 1,
      });
    });

    const light = ctx.binding.get(entity) as THREE.AmbientLight;
    expect(light.intensity).toBe(1);

    runFrame(ctx, () => {
      const data = ctx.world.getMut(entity, "AmbientLight")!;
      data.intensity = 3;
    });

    expect(light.intensity).toBe(3);
  });

  it("updating PointLight properties syncs to Three.js", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "PointLight", {
        color: [1, 1, 1, 1],
        intensity: 1,
        distance: 0,
        decay: 2,
      });
    });

    const light = ctx.binding.get(entity) as THREE.PointLight;

    runFrame(ctx, () => {
      const data = ctx.world.getMut(entity, "PointLight")!;
      data.distance = 50;
      data.decay = 1;
      data.intensity = 5;
    });

    expect(light.intensity).toBe(5);
    expect(light.distance).toBe(50);
    expect(light.decay).toBe(1);
  });

  it("removing DirectionalLight component removes light and helper from scene", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "DirectionalLight", {
        color: [1, 1, 1, 1],
        intensity: 1,
      });
    });

    expect(ctx.binding.get(entity)).toBeDefined();
    expect(
      ctx.binding.scene.children.some(
        (c) => c instanceof THREE.DirectionalLightHelper
      )
    ).toBe(true);

    runFrame(ctx, () => {
      ctx.world.removeComponent(entity, "DirectionalLight");
    });

    expect(ctx.binding.get(entity)).toBeUndefined();
    expect(
      ctx.binding.scene.children.some(
        (c) => c instanceof THREE.DirectionalLightHelper
      )
    ).toBe(false);
  });

  it("removing AmbientLight component removes it from scene", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "AmbientLight", {
        color: [0.5, 0.5, 0.5, 1],
        intensity: 1,
      });
    });

    expect(ctx.binding.get(entity)).toBeDefined();

    runFrame(ctx, () => {
      ctx.world.removeComponent(entity, "AmbientLight");
    });

    expect(ctx.binding.get(entity)).toBeUndefined();
  });

  it("removing PointLight component removes it from scene", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "PointLight", {
        color: [1, 1, 1, 1],
        intensity: 1,
        distance: 0,
        decay: 2,
      });
    });

    expect(ctx.binding.get(entity)).toBeDefined();

    runFrame(ctx, () => {
      ctx.world.removeComponent(entity, "PointLight");
    });

    expect(ctx.binding.get(entity)).toBeUndefined();
  });

  it("DirectionalLight with Transform3D gets position applied", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "Transform3D", {
        position: [5, 10, 7],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      ctx.world.setComponent(entity, "DirectionalLight", {
        color: [1, 1, 1, 1],
        intensity: 1.5,
      });
    });

    const light = ctx.binding.get(entity) as THREE.DirectionalLight;
    expect(light.position.x).toBe(5);
    expect(light.position.y).toBe(10);
    expect(light.position.z).toBe(7);
  });

  it("PointLight with Transform3D gets position applied", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "Transform3D", {
        position: [3, 6, 9],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      ctx.world.setComponent(entity, "PointLight", {
        color: [1, 0, 0, 1],
        intensity: 2,
        distance: 20,
        decay: 1,
      });
    });

    const light = ctx.binding.get(entity) as THREE.PointLight;
    expect(light.position.x).toBe(3);
    expect(light.position.y).toBe(6);
    expect(light.position.z).toBe(9);
  });

  it("Transform3D update moves DirectionalLight position", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "Transform3D", {
        position: [0, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      ctx.world.setComponent(entity, "DirectionalLight", {
        color: [1, 1, 1, 1],
        intensity: 1,
      });
    });

    runFrame(ctx, () => {
      const t = ctx.world.getMut(entity, "Transform3D")!;
      t.position = [10, 20, 30];
    });

    const light = ctx.binding.get(entity) as THREE.DirectionalLight;
    expect(light.position.x).toBe(10);
    expect(light.position.y).toBe(20);
    expect(light.position.z).toBe(30);
  });

  it("Transform3D update moves PointLight position", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "Transform3D", {
        position: [1, 2, 3],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      ctx.world.setComponent(entity, "PointLight", {
        color: [1, 1, 1, 1],
        intensity: 1,
        distance: 0,
        decay: 2,
      });
    });

    runFrame(ctx, () => {
      const t = ctx.world.getMut(entity, "Transform3D")!;
      t.position = [7, 8, 9];
    });

    const light = ctx.binding.get(entity) as THREE.PointLight;
    expect(light.position.x).toBe(7);
    expect(light.position.y).toBe(8);
    expect(light.position.z).toBe(9);
  });

  it("schema defaults produce valid light", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "DirectionalLight");
    });

    const light = ctx.binding.get(entity) as THREE.DirectionalLight;
    expect(light).toBeInstanceOf(THREE.DirectionalLight);
    expect(light.intensity).toBe(1);
    // Default color from colorTuple is [0.8, 0.8, 0.8, 1.0]
    expect(light.color.r).toBeCloseTo(0.8);
    expect(light.color.g).toBeCloseTo(0.8);
    expect(light.color.b).toBeCloseTo(0.8);
  });
});
