import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { createWorld } from "../ecs/world";
import { renderingRegistry } from "./components";
import { ThreeBinding } from "./binding";
import { Hierarchy } from "../ecs/hierarchy";
import { CommandBuffer } from "../ecs/commands";
import { createRenderSyncSystem, createTransformSyncSystem } from "./systems";

type R = typeof renderingRegistry;

function setup() {
  const world = createWorld(renderingRegistry);
  const binding = new ThreeBinding(world);
  const hierarchy = new Hierarchy(world);
  const commands = new CommandBuffer(world);
  const renderSync = createRenderSyncSystem(binding);
  const transformSync = createTransformSyncSystem(binding, { hierarchy });
  return { world, binding, hierarchy, commands, renderSync, transformSync };
}

function runFrame(ctx: ReturnType<typeof setup>, fn?: () => void) {
  ctx.world.beginFrame();
  fn?.();
  ctx.renderSync(ctx.world, 0, ctx.commands);
  ctx.transformSync(ctx.world, 0, ctx.commands);
  ctx.commands.flush();
  ctx.world.endFrame();
}

describe("Hierarchy → Three.js parenting", () => {
  it("entity with parent: Three.js object is child of parent Object3D", () => {
    const ctx = setup();
    const parent = ctx.world.createEntity();
    const child = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(parent, "MeshRenderer");
      ctx.world.setComponent(parent, "Transform3D");
      ctx.world.setComponent(child, "MeshRenderer");
      ctx.world.setComponent(child, "Transform3D");
      ctx.hierarchy.setParent(child, parent);
    });

    const parentObj = ctx.binding.get(parent)!;
    const childObj = ctx.binding.get(child)!;

    expect(parentObj.parent).toBe(ctx.binding.scene);
    expect(childObj.parent).toBe(parentObj);
    // Scene should only have the parent as a direct child
    expect(ctx.binding.scene.children).toHaveLength(1);
    expect(ctx.binding.scene.children[0]).toBe(parentObj);
    expect(parentObj.children).toHaveLength(1);
    expect(parentObj.children[0]).toBe(childObj);
  });

  it("reparenting: changing parent moves the Three.js object", () => {
    const ctx = setup();
    const parentA = ctx.world.createEntity();
    const parentB = ctx.world.createEntity();
    const child = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(parentA, "MeshRenderer");
      ctx.world.setComponent(parentA, "Transform3D");
      ctx.world.setComponent(parentB, "MeshRenderer");
      ctx.world.setComponent(parentB, "Transform3D");
      ctx.world.setComponent(child, "MeshRenderer");
      ctx.world.setComponent(child, "Transform3D");
      ctx.hierarchy.setParent(child, parentA);
    });

    const parentAObj = ctx.binding.get(parentA)!;
    const parentBObj = ctx.binding.get(parentB)!;
    const childObj = ctx.binding.get(child)!;

    expect(childObj.parent).toBe(parentAObj);

    // Reparent child to parentB
    runFrame(ctx, () => {
      ctx.hierarchy.setParent(child, parentB);
    });

    expect(childObj.parent).toBe(parentBObj);
    expect(parentAObj.children).toHaveLength(0);
    expect(parentBObj.children).toHaveLength(1);
    expect(parentBObj.children[0]).toBe(childObj);
  });

  it("orphaning (removeParent): object moves back to scene root", () => {
    const ctx = setup();
    const parent = ctx.world.createEntity();
    const child = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(parent, "MeshRenderer");
      ctx.world.setComponent(parent, "Transform3D");
      ctx.world.setComponent(child, "MeshRenderer");
      ctx.world.setComponent(child, "Transform3D");
      ctx.hierarchy.setParent(child, parent);
    });

    const parentObj = ctx.binding.get(parent)!;
    const childObj = ctx.binding.get(child)!;
    expect(childObj.parent).toBe(parentObj);

    // Remove parent (orphan the child)
    runFrame(ctx, () => {
      ctx.hierarchy.removeParent(child);
    });

    expect(childObj.parent).toBe(ctx.binding.scene);
    expect(parentObj.children).toHaveLength(0);
    expect(ctx.binding.scene.children).toHaveLength(2);
  });

  it("child created before parent has Object3D: gets reparented once parent is synced", () => {
    const ctx = setup();
    const parent = ctx.world.createEntity();
    const child = ctx.world.createEntity();

    // First frame: only child gets a mesh, parent has no MeshRenderer yet
    runFrame(ctx, () => {
      ctx.world.setComponent(child, "MeshRenderer");
      ctx.world.setComponent(child, "Transform3D");
      ctx.hierarchy.setParent(child, parent);
    });

    const childObj = ctx.binding.get(child)!;
    // Child should be on scene root because parent has no Object3D yet
    expect(childObj.parent).toBe(ctx.binding.scene);

    // Second frame: parent gets a mesh
    runFrame(ctx, () => {
      ctx.world.setComponent(parent, "MeshRenderer");
      ctx.world.setComponent(parent, "Transform3D");
    });

    const parentObj = ctx.binding.get(parent)!;
    // Now child should be reparented to the parent's Object3D
    expect(childObj.parent).toBe(parentObj);
    expect(parentObj.children).toHaveLength(1);
    expect(parentObj.children[0]).toBe(childObj);
  });

  it("hierarchy with Transform3D: child position is local to parent", () => {
    const ctx = setup();
    const parent = ctx.world.createEntity();
    const child = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(parent, "MeshRenderer");
      ctx.world.setComponent(parent, "Transform3D", {
        position: [10, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      ctx.world.setComponent(child, "MeshRenderer");
      ctx.world.setComponent(child, "Transform3D", {
        position: [0, 5, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      ctx.hierarchy.setParent(child, parent);
    });

    const childObj = ctx.binding.get(child)!;

    // The local position should be [0, 5, 0]
    expect(childObj.position.x).toBe(0);
    expect(childObj.position.y).toBe(5);
    expect(childObj.position.z).toBe(0);

    // The world position should be [10, 5, 0] (parent's [10,0,0] + child's [0,5,0])
    const worldPos = new THREE.Vector3();
    childObj.getWorldPosition(worldPos);
    expect(worldPos.x).toBe(10);
    expect(worldPos.y).toBe(5);
    expect(worldPos.z).toBe(0);
  });

  it("deep hierarchy: grandchild world position composes all ancestors", () => {
    const ctx = setup();
    const grandparent = ctx.world.createEntity();
    const parent = ctx.world.createEntity();
    const child = ctx.world.createEntity();

    runFrame(ctx, () => {
      ctx.world.setComponent(grandparent, "MeshRenderer");
      ctx.world.setComponent(grandparent, "Transform3D", {
        position: [1, 0, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      ctx.world.setComponent(parent, "MeshRenderer");
      ctx.world.setComponent(parent, "Transform3D", {
        position: [0, 2, 0],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      ctx.world.setComponent(child, "MeshRenderer");
      ctx.world.setComponent(child, "Transform3D", {
        position: [0, 0, 3],
        rotation: [0, 0, 0, 1],
        scale: [1, 1, 1],
      });
      ctx.hierarchy.setParent(parent, grandparent);
      ctx.hierarchy.setParent(child, parent);
    });

    const childObj = ctx.binding.get(child)!;
    const worldPos = new THREE.Vector3();
    childObj.getWorldPosition(worldPos);

    expect(worldPos.x).toBe(1);
    expect(worldPos.y).toBe(2);
    expect(worldPos.z).toBe(3);
  });
});
