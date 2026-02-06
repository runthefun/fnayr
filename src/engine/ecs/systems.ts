import type { ComponentRegistry, World } from "./types";
import type { Commands } from "./commands";
import { CommandBuffer } from "./commands";

/**
 * Runtime system function signature.
 * The optional third parameter provides a deferred command buffer.
 */
export type System<R extends ComponentRegistry> = (
  world: World<R>,
  dt: number,
  commands: Commands<R>
) => void;

interface SystemEntry<R extends ComponentRegistry> {
  system: System<R>;
  enabled: boolean;
}

/**
 * Deterministic system scheduler with named execution phases.
 */
export class Scheduler<R extends ComponentRegistry> {
  private readonly world: World<R>;
  private readonly phaseOrder: string[];
  private readonly phases: Map<string, SystemEntry<R>[]>;

  /**
   * Creates a scheduler bound to a world.
   * @param world - The ECS world to run systems against.
   * @param phases - Optional array of phase names defining execution order.
   *                 Defaults to ['update'] for backward compatibility.
   */
  constructor(world: World<R>, phases?: string[]) {
    this.world = world;
    this.phaseOrder = phases ?? ["update"];
    this.phases = new Map();
    for (const phase of this.phaseOrder) {
      this.phases.set(phase, []);
    }
  }

  /**
   * Adds a system to a phase.
   * When called with one argument, adds to the 'update' phase (backward compatible).
   * When called with two arguments, the first is the phase name.
   */
  addSystem(system: System<R>): void;
  addSystem(phase: string, system: System<R>): void;
  addSystem(phaseOrSystem: string | System<R>, maybeSystem?: System<R>): void {
    let phase: string;
    let system: System<R>;

    if (typeof phaseOrSystem === "function") {
      phase = "update";
      system = phaseOrSystem;
    } else {
      phase = phaseOrSystem;
      system = maybeSystem!;
    }

    const entries = this.phases.get(phase);
    if (!entries) {
      throw new Error(`Unknown phase: ${phase}`);
    }
    entries.push({ system, enabled: true });
  }

  /**
   * Removes a system from whatever phase it's in.
   */
  removeSystem(system: System<R>): void {
    for (const entries of this.phases.values()) {
      const idx = entries.findIndex((e) => e.system === system);
      if (idx !== -1) {
        entries.splice(idx, 1);
        return;
      }
    }
  }

  /**
   * Enables a previously disabled system.
   */
  enableSystem(system: System<R>): void {
    for (const entries of this.phases.values()) {
      const entry = entries.find((e) => e.system === system);
      if (entry) {
        entry.enabled = true;
        return;
      }
    }
  }

  /**
   * Disables a system so it is skipped during runFrame.
   */
  disableSystem(system: System<R>): void {
    for (const entries of this.phases.values()) {
      const entry = entries.find((e) => e.system === system);
      if (entry) {
        entry.enabled = false;
        return;
      }
    }
  }

  /**
   * Runs all systems in phase order for the given frame delta.
   * Calls world.beginFrame() at the start and world.endFrame() at the end.
   */
  runFrame(dt: number): void {
    this.world.beginFrame();
    for (const phase of this.phaseOrder) {
      const entries = this.phases.get(phase)!;
      for (const entry of entries) {
        if (entry.enabled) {
          const cmds = new CommandBuffer(this.world);
          entry.system(this.world, dt, cmds);
          cmds.flush();
        }
      }
    }
    this.world.endFrame();
  }
}
