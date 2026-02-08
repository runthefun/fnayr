import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { createWorld } from "../ecs/world";
import { renderingRegistry } from "./components";
import { ThreeBinding } from "./binding";
import { CommandBuffer } from "../ecs/commands";
import { createLightSyncSystem, createBackgroundSyncSystem } from "./lights";
import { createTransformSyncSystem } from "./systems";
import { EDITOR_LAYER } from "./constants";

type R = typeof renderingRegistry;

function setup() {
  const world = createWorld(renderingRegistry);
  const scene = new THREE.Scene();
  const binding = new ThreeBinding(world, scene);
  const commands = new CommandBuffer(world);
  const lightSync = createLightSyncSystem(scene);
  const transformSync = createTransformSyncSystem(binding);
  return { world, scene, binding, commands, lightSync, transformSync };
}

function runFrame(ctx: ReturnType<typeof setup>, fn?: () => void) {
  ctx.world.beginFrame();
  fn?.();
  ctx.lightSync(ctx.world, 0, ctx.commands);
  ctx.transformSync(ctx.world, 0, ctx.commands);
  ctx.commands.flush();
  ctx.world.endFrame();
}

/** Find a Three.js object in the scene by entity ID and optional type */
function findInScene<T extends THREE.Object3D>(
  scene: THREE.Scene,
  entity: number,
  type?: new (...args: any[]) => T
): T | undefined {
  return scene.children.find(
    (c) =>
      c.userData.entityId === entity && (type ? c instanceof type : true)
  ) as T | undefined;
}

describe("Light sync system", () => {
  it("DirectionalLight added -> THREE.DirectionalLight appears in scene", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "DirectionalLight", {
        color: [1, 1, 1, 1],
        intensity: 1.5,
      });
    });

    const light = findInScene(ctx.scene, entity, THREE.DirectionalLight);
    expect(light).toBeInstanceOf(THREE.DirectionalLight);
    expect(light!.intensity).toBe(1.5);
    expect(light!.color.r).toBe(1);
    expect(light!.color.g).toBe(1);
    expect(light!.color.b).toBe(1);
  });

  it("DirectionalLight has a DirectionalLightHelper on the editor layer", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "DirectionalLight");
    });

    const helper = ctx.scene.children.find(
      (c) => c instanceof THREE.DirectionalLightHelper
    );
    expect(helper).toBeInstanceOf(THREE.DirectionalLightHelper);
    expect(helper!.userData.entityId).toBe(entity);
    expect(helper!.layers.isEnabled(EDITOR_LAYER)).toBe(true);
    expect(helper!.layers.isEnabled(0)).toBe(false);
  });

  it("AmbientLight added -> THREE.AmbientLight appears in scene", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "AmbientLight", {
        color: [0.25, 0.25, 0.25, 1],
        intensity: 2,
      });
    });

    const light = findInScene(ctx.scene, entity, THREE.AmbientLight);
    expect(light).toBeInstanceOf(THREE.AmbientLight);
    expect(light!.intensity).toBe(2);
    expect(light!.color.r).toBeCloseTo(0.25);
    expect(light!.color.g).toBeCloseTo(0.25);
    expect(light!.color.b).toBeCloseTo(0.25);
  });

  it("AmbientLight has no helper in the scene", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "AmbientLight");
    });

    const helpers = ctx.scene.children.filter(
      (c) =>
        c instanceof THREE.DirectionalLightHelper ||
        c instanceof THREE.PointLightHelper
    );
    expect(helpers).toHaveLength(0);
  });

  it("PointLight added -> THREE.PointLight appears in scene", () => {
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

    const light = findInScene(ctx.scene, entity, THREE.PointLight)!;
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

    const helper = ctx.scene.children.find(
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

    const light = findInScene(ctx.scene, entity, THREE.DirectionalLight)!;
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

    const light = findInScene(ctx.scene, entity, THREE.AmbientLight)!;
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

    const light = findInScene(ctx.scene, entity, THREE.PointLight)!;

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

    expect(findInScene(ctx.scene, entity, THREE.DirectionalLight)).toBeDefined();
    expect(
      ctx.scene.children.some(
        (c) => c instanceof THREE.DirectionalLightHelper
      )
    ).toBe(true);

    runFrame(ctx, () => {
      ctx.world.removeComponent(entity, "DirectionalLight");
    });

    expect(findInScene(ctx.scene, entity, THREE.DirectionalLight)).toBeUndefined();
    expect(
      ctx.scene.children.some(
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

    expect(findInScene(ctx.scene, entity, THREE.AmbientLight)).toBeDefined();

    runFrame(ctx, () => {
      ctx.world.removeComponent(entity, "AmbientLight");
    });

    expect(findInScene(ctx.scene, entity, THREE.AmbientLight)).toBeUndefined();
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

    expect(findInScene(ctx.scene, entity, THREE.PointLight)).toBeDefined();

    runFrame(ctx, () => {
      ctx.world.removeComponent(entity, "PointLight");
    });

    expect(findInScene(ctx.scene, entity, THREE.PointLight)).toBeUndefined();
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

    const light = findInScene(ctx.scene, entity, THREE.DirectionalLight)!;
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

    const light = findInScene(ctx.scene, entity, THREE.PointLight)!;
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

    const light = findInScene(ctx.scene, entity, THREE.DirectionalLight)!;
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

    const light = findInScene(ctx.scene, entity, THREE.PointLight)!;
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

    const light = findInScene(ctx.scene, entity, THREE.DirectionalLight)!;
    expect(light).toBeInstanceOf(THREE.DirectionalLight);
    expect(light.intensity).toBe(1);
    // Default color from colorTuple is [0.8, 0.8, 0.8, 1.0]
    expect(light.color.r).toBeCloseTo(0.8);
    expect(light.color.g).toBeCloseTo(0.8);
    expect(light.color.b).toBeCloseTo(0.8);
  });

  // --- SpotLight tests ---

  it("SpotLight added -> THREE.SpotLight appears in scene", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "SpotLight", {
        color: 0xff0000,
        intensity: 2,
        distance: 15,
        angle: Math.PI / 4,
        penumbra: 0.5,
        decay: 1,
        castShadow: true,
        showHelper: false,
      });
    });

    const light = findInScene(ctx.scene, entity, THREE.SpotLight)!;
    expect(light).toBeInstanceOf(THREE.SpotLight);
    expect(light.intensity).toBe(2);
    expect(light.distance).toBe(15);
    expect(light.angle).toBe(Math.PI / 4);
    expect(light.penumbra).toBe(0.5);
    expect(light.decay).toBe(1);
    expect(light.castShadow).toBe(true);
  });

  it("SpotLight property update syncs to Three.js", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "SpotLight", {
        color: 0xffffff,
        intensity: 1,
        distance: 0,
        angle: Math.PI / 3,
        penumbra: 0,
        decay: 2,
        castShadow: false,
        showHelper: false,
      });
    });

    const light = findInScene(ctx.scene, entity, THREE.SpotLight)!;

    runFrame(ctx, () => {
      const data = ctx.world.getMut(entity, "SpotLight")!;
      data.intensity = 5;
      data.distance = 30;
      data.angle = Math.PI / 6;
      data.penumbra = 0.8;
      data.decay = 1;
      data.castShadow = true;
    });

    expect(light.intensity).toBe(5);
    expect(light.distance).toBe(30);
    expect(light.angle).toBe(Math.PI / 6);
    expect(light.penumbra).toBe(0.8);
    expect(light.decay).toBe(1);
    expect(light.castShadow).toBe(true);
  });

  it("removing SpotLight component removes it from scene", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "SpotLight", {
        color: 0xffffff,
        intensity: 1,
        distance: 0,
        angle: Math.PI / 3,
        penumbra: 0,
        decay: 2,
        castShadow: false,
        showHelper: false,
      });
    });

    expect(findInScene(ctx.scene, entity, THREE.SpotLight)).toBeDefined();

    runFrame(ctx, () => {
      ctx.world.removeComponent(entity, "SpotLight");
    });

    expect(findInScene(ctx.scene, entity, THREE.SpotLight)).toBeUndefined();
  });

  it("SpotLight helper appears when showHelper is true on add", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "SpotLight", {
        color: 0xffffff,
        intensity: 1,
        distance: 0,
        angle: Math.PI / 3,
        penumbra: 0,
        decay: 2,
        castShadow: false,
        showHelper: true,
      });
    });

    const helper = ctx.scene.children.find(
      (c) => c instanceof THREE.SpotLightHelper
    );
    expect(helper).toBeInstanceOf(THREE.SpotLightHelper);
    expect(helper!.userData.entityId).toBe(entity);
    expect(helper!.layers.isEnabled(EDITOR_LAYER)).toBe(true);
  });

  it("SpotLight helper does not appear when showHelper is false", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "SpotLight", {
        color: 0xffffff,
        intensity: 1,
        distance: 0,
        angle: Math.PI / 3,
        penumbra: 0,
        decay: 2,
        castShadow: false,
        showHelper: false,
      });
    });

    const helper = ctx.scene.children.find(
      (c) => c instanceof THREE.SpotLightHelper
    );
    expect(helper).toBeUndefined();
  });

  it("SpotLight helper toggles on when showHelper changes to true", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "SpotLight", {
        color: 0xffffff,
        intensity: 1,
        distance: 0,
        angle: Math.PI / 3,
        penumbra: 0,
        decay: 2,
        castShadow: false,
        showHelper: false,
      });
    });

    expect(
      ctx.scene.children.find((c) => c instanceof THREE.SpotLightHelper)
    ).toBeUndefined();

    runFrame(ctx, () => {
      const data = ctx.world.getMut(entity, "SpotLight")!;
      data.showHelper = true;
    });

    const helper = ctx.scene.children.find(
      (c) => c instanceof THREE.SpotLightHelper
    );
    expect(helper).toBeInstanceOf(THREE.SpotLightHelper);
  });

  it("SpotLight helper toggles off when showHelper changes to false", () => {
    const ctx = setup();
    const entity = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(entity, "SpotLight", {
        color: 0xffffff,
        intensity: 1,
        distance: 0,
        angle: Math.PI / 3,
        penumbra: 0,
        decay: 2,
        castShadow: false,
        showHelper: true,
      });
    });

    expect(
      ctx.scene.children.find((c) => c instanceof THREE.SpotLightHelper)
    ).toBeDefined();

    runFrame(ctx, () => {
      const data = ctx.world.getMut(entity, "SpotLight")!;
      data.showHelper = false;
    });

    expect(
      ctx.scene.children.find((c) => c instanceof THREE.SpotLightHelper)
    ).toBeUndefined();
  });
});

describe("Background sync system", () => {
  function setupBg() {
    const world = createWorld(renderingRegistry);
    const scene = new THREE.Scene();
    const commands = new CommandBuffer(world);
    const bgSync = createBackgroundSyncSystem(scene);
    return { world, scene, commands, bgSync };
  }

  function runBgFrame(ctx: ReturnType<typeof setupBg>, fn?: () => void) {
    ctx.world.beginFrame();
    fn?.();
    ctx.bgSync(ctx.world, 0, ctx.commands);
    ctx.commands.flush();
    ctx.world.endFrame();
  }

  it("Background added -> scene.background is set", () => {
    const ctx = setupBg();
    const entity = ctx.world.createEntity();

    runBgFrame(ctx, () => {
      ctx.world.setComponent(entity, "Background", {
        color: [0.2, 0.4, 0.6, 1],
        intensity: 1,
        blurriness: 0,
      });
    });

    expect(ctx.scene.background).toBeInstanceOf(THREE.Color);
    const bg = ctx.scene.background as THREE.Color;
    expect(bg.r).toBeCloseTo(0.2);
    expect(bg.g).toBeCloseTo(0.4);
    expect(bg.b).toBeCloseTo(0.6);
  });

  it("Background updated -> scene.background is updated", () => {
    const ctx = setupBg();
    const entity = ctx.world.createEntity();

    runBgFrame(ctx, () => {
      ctx.world.setComponent(entity, "Background", {
        color: [0.1, 0.1, 0.1, 1],
        intensity: 1,
        blurriness: 0,
      });
    });

    runBgFrame(ctx, () => {
      const data = ctx.world.getMut(entity, "Background")!;
      data.color = [1, 0, 0, 1];
    });

    const bg = ctx.scene.background as THREE.Color;
    expect(bg.r).toBeCloseTo(1);
    expect(bg.g).toBeCloseTo(0);
    expect(bg.b).toBeCloseTo(0);
  });

  it("Background removed -> scene.background is null", () => {
    const ctx = setupBg();
    const entity = ctx.world.createEntity();

    runBgFrame(ctx, () => {
      ctx.world.setComponent(entity, "Background", {
        color: [0.5, 0.5, 0.5, 1],
        intensity: 1,
        blurriness: 0,
      });
    });

    expect(ctx.scene.background).not.toBeNull();

    runBgFrame(ctx, () => {
      ctx.world.removeComponent(entity, "Background");
    });

    expect(ctx.scene.background).toBeNull();
  });

  it("schema defaults produce valid background", () => {
    const ctx = setupBg();
    const entity = ctx.world.createEntity();

    runBgFrame(ctx, () => {
      ctx.world.setComponent(entity, "Background");
    });

    expect(ctx.scene.background).toBeInstanceOf(THREE.Color);
    const bg = ctx.scene.background as THREE.Color;
    // Default colorTuple is [0.8, 0.8, 0.8, 1.0]
    expect(bg.r).toBeCloseTo(0.8);
    expect(bg.g).toBeCloseTo(0.8);
    expect(bg.b).toBeCloseTo(0.8);
    expect(ctx.scene.backgroundIntensity).toBe(1);
    expect(ctx.scene.backgroundBlurriness).toBe(0);
  });

  it("intensity and blurriness are applied on add", () => {
    const ctx = setupBg();
    const entity = ctx.world.createEntity();

    runBgFrame(ctx, () => {
      ctx.world.setComponent(entity, "Background", {
        color: [0, 0, 0, 1],
        intensity: 2.5,
        blurriness: 0.7,
      });
    });

    expect(ctx.scene.backgroundIntensity).toBe(2.5);
    expect(ctx.scene.backgroundBlurriness).toBeCloseTo(0.7);
  });

  it("intensity and blurriness update on change", () => {
    const ctx = setupBg();
    const entity = ctx.world.createEntity();

    runBgFrame(ctx, () => {
      ctx.world.setComponent(entity, "Background", {
        color: [0, 0, 0, 1],
        intensity: 1,
        blurriness: 0,
      });
    });

    runBgFrame(ctx, () => {
      const data = ctx.world.getMut(entity, "Background")!;
      data.intensity = 0.5;
      data.blurriness = 0.3;
    });

    expect(ctx.scene.backgroundIntensity).toBe(0.5);
    expect(ctx.scene.backgroundBlurriness).toBeCloseTo(0.3);
  });

  it("removal resets intensity and blurriness to defaults", () => {
    const ctx = setupBg();
    const entity = ctx.world.createEntity();

    runBgFrame(ctx, () => {
      ctx.world.setComponent(entity, "Background", {
        color: [0, 0, 0, 1],
        intensity: 3,
        blurriness: 0.9,
      });
    });

    runBgFrame(ctx, () => {
      ctx.world.removeComponent(entity, "Background");
    });

    expect(ctx.scene.background).toBeNull();
    expect(ctx.scene.backgroundIntensity).toBe(1);
    expect(ctx.scene.backgroundBlurriness).toBe(0);
  });
});
