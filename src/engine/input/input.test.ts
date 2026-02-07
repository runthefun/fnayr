import { describe, expect, it } from "vitest";
import type { ComponentRegistry } from "../ecs/types";
import { InputBinding } from "./input";
import { createInputSystem } from "./systems";
import { createWorld } from "../ecs/world";
import { CommandBuffer } from "../ecs/commands";
import { s } from "../schema";

describe("InputBinding", () => {
  function setup() {
    const input = new InputBinding();
    return { input };
  }

  // ── Keyboard ──

  describe("keyboard", () => {
    it("isKeyDown returns true while key is held", () => {
      const { input } = setup();
      input.simulateKeyDown("KeyW");
      input.poll();
      expect(input.isKeyDown("KeyW")).toBe(true);
    });

    it("isKeyDown returns false after key is released", () => {
      const { input } = setup();
      input.simulateKeyDown("KeyW");
      input.poll();

      input.simulateKeyUp("KeyW");
      input.poll();
      expect(input.isKeyDown("KeyW")).toBe(false);
    });

    it("justPressed is true only for one frame", () => {
      const { input } = setup();
      input.simulateKeyDown("Space");
      input.poll();
      expect(input.isKeyJustPressed("Space")).toBe(true);

      // Next frame: key still held but not just pressed
      input.poll();
      expect(input.isKeyJustPressed("Space")).toBe(false);
      expect(input.isKeyDown("Space")).toBe(true);
    });

    it("justReleased is true only for one frame", () => {
      const { input } = setup();
      input.simulateKeyDown("KeyA");
      input.poll();

      input.simulateKeyUp("KeyA");
      input.poll();
      expect(input.isKeyJustReleased("KeyA")).toBe(true);

      // Next frame: no longer just released
      input.poll();
      expect(input.isKeyJustReleased("KeyA")).toBe(false);
    });

    it("key repeat is ignored (simulateKeyDown while held does not re-trigger justPressed)", () => {
      const { input } = setup();
      input.simulateKeyDown("KeyW");
      input.poll();
      expect(input.isKeyJustPressed("KeyW")).toBe(true);

      // Simulate repeat: call simulateKeyDown again while held
      input.simulateKeyDown("KeyW");
      input.poll();
      expect(input.isKeyJustPressed("KeyW")).toBe(false);
      expect(input.isKeyDown("KeyW")).toBe(true);
    });

    it("press and release in same frame: both justPressed and justReleased are true, down is false", () => {
      const { input } = setup();
      input.simulateKeyDown("KeyX");
      input.simulateKeyUp("KeyX");
      input.poll();

      expect(input.isKeyJustPressed("KeyX")).toBe(true);
      expect(input.isKeyJustReleased("KeyX")).toBe(true);
      expect(input.isKeyDown("KeyX")).toBe(false);
    });

    it("keyboard state snapshot reflects held keys", () => {
      const { input } = setup();
      input.simulateKeyDown("KeyW");
      input.simulateKeyDown("KeyS");
      input.poll();

      expect(input.keyboard.held.has("KeyW")).toBe(true);
      expect(input.keyboard.held.has("KeyS")).toBe(true);
      expect(input.keyboard.justPressed.has("KeyW")).toBe(true);
    });
  });

  // ── Mouse ──

  describe("mouse", () => {
    it("tracks mouse position", () => {
      const { input } = setup();
      input.simulateMouseMove(100, 200, 10, 20);
      input.poll();

      expect(input.mouse.x).toBe(100);
      expect(input.mouse.y).toBe(200);
    });

    it("accumulates movement deltas", () => {
      const { input } = setup();
      input.simulateMouseMove(10, 10, 5, 3);
      input.simulateMouseMove(20, 20, 8, 2);
      input.poll();

      expect(input.mouse.dx).toBe(13); // 5 + 8
      expect(input.mouse.dy).toBe(5);  // 3 + 2
    });

    it("resets deltas after poll", () => {
      const { input } = setup();
      input.simulateMouseMove(10, 10, 5, 3);
      input.poll();
      expect(input.mouse.dx).toBe(5);

      // Next frame with no movement
      input.poll();
      expect(input.mouse.dx).toBe(0);
      expect(input.mouse.dy).toBe(0);
    });

    it("tracks scroll deltas and resets after poll", () => {
      const { input } = setup();
      input.simulateScroll(10, 20);
      input.simulateScroll(5, 15);
      input.poll();

      expect(input.mouse.scrollX).toBe(15);
      expect(input.mouse.scrollY).toBe(35);

      input.poll();
      expect(input.mouse.scrollX).toBe(0);
      expect(input.mouse.scrollY).toBe(0);
    });

    it("button justPressed is true only for one frame", () => {
      const { input } = setup();
      input.simulateMouseDown(0);
      input.poll();

      expect(input.mouse.buttons[0].down).toBe(true);
      expect(input.mouse.buttons[0].justPressed).toBe(true);

      // Next frame: still held but not just pressed
      input.poll();
      expect(input.mouse.buttons[0].down).toBe(true);
      expect(input.mouse.buttons[0].justPressed).toBe(false);
    });

    it("button justReleased is true only for one frame", () => {
      const { input } = setup();
      input.simulateMouseDown(0);
      input.poll();

      input.simulateMouseUp(0);
      input.poll();
      expect(input.mouse.buttons[0].down).toBe(false);
      expect(input.mouse.buttons[0].justReleased).toBe(true);

      input.poll();
      expect(input.mouse.buttons[0].justReleased).toBe(false);
    });

    it("right mouse button tracked separately", () => {
      const { input } = setup();
      input.simulateMouseDown(2);
      input.poll();

      expect(input.mouse.buttons[2].down).toBe(true);
      expect(input.mouse.buttons[0].down).toBe(false);
    });
  });

  // ── Gamepad ──

  describe("gamepad", () => {
    it("returns undefined when no gamepad connected", () => {
      const { input } = setup();
      input.poll();
      expect(input.getGamepad(0)).toBeUndefined();
    });
  });

  // ── Integration with createInputSystem ──

  describe("createInputSystem", () => {
    it("system calls poll() on the binding", () => {
      const input = new InputBinding();
      const registry = { _dummy: s.number() };
      type R = typeof registry;
      const world = createWorld(registry);
      const system = createInputSystem<R>(input);

      // Simulate a key press
      input.simulateKeyDown("KeyW");

      // Before system runs, poll hasn't been called — snapshot is empty
      expect(input.isKeyDown("KeyW")).toBe(false);

      // Run the system within a frame
      world.beginFrame();
      const cmds = new CommandBuffer(world);
      system(world, 0.016, cmds);
      cmds.flush();
      world.endFrame();

      // After system runs, poll() was called — state is updated
      expect(input.isKeyDown("KeyW")).toBe(true);
      expect(input.isKeyJustPressed("KeyW")).toBe(true);
    });
  });
});
